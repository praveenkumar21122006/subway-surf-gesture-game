// gesture.js — Hand gesture controls using MediaPipe Tasks Vision (runs fully local)
let landmarker = null;
let running = false;
let video = null;
let overlay = null;
let octx = null;
let lastVideoTime = -1;
let rafId = 0;

let swipeThreshold = 0.15; // normalized units, smaller = more sensitive
let posControlEnabled = true;

const history = []; // {x,y,t}
const cooldowns = { left: 0, right: 0, up: 0, down: 0, jumpPose: 0, slidePose: 0 };
let poseStreak = { open: 0, fist: 0 };
let lastZone = 1;
let callbacks = {};
let statusEl = null;

function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }

// Rotation-invariant: finger extended if tip farther from wrist than pip joint
function countExtendedFingers(lm) {
  const wrist = lm[0];
  const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
  let count = 0;
  for (const [tip, pip] of pairs) {
    if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.12) count++;
  }
  // thumb: tip farther from index-mcp (5) than ip joint (3) is
  if (dist(lm[4], lm[5]) > dist(lm[3], lm[5]) * 1.15) count++;
  return count;
}

function setStatus(msg) { if (statusEl) statusEl.innerHTML = msg; }

function drawHand(lm) {
  if (!octx || !overlay) return;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const W = overlay.width, H = overlay.height;
  const CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  octx.lineWidth = 2; octx.strokeStyle = '#22c55e';
  octx.beginPath();
  for (const [a, b] of CONN) { octx.moveTo(lm[a].x * W, lm[a].y * H); octx.lineTo(lm[b].x * W, lm[b].y * H); }
  octx.stroke();
  octx.fillStyle = '#facc15';
  for (const p of lm) { octx.beginPath(); octx.arc(p.x * W, p.y * H, 3, 0, 7); octx.fill(); }
}

function fire(name, extra = '') {
  const now = performance.now();
  const cd = { left: 450, right: 450, up: 600, down: 600 }[name] ?? 500;
  if (now - (cooldowns[name] || 0) < cd) return;
  cooldowns[name] = now;
  showToast({ left: '⬅️', right: '➡️', up: '⬆️', down: '⬇️' }[name] || '✋');
  callbacks['on' + name[0].toUpperCase() + name.slice(1)]?.();
  updateBadge(name + extra);
}

function showToast(emoji) {
  const el = document.getElementById('gesture-toast');
  if (!el) return;
  el.textContent = emoji;
  el.style.opacity = '1';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (el.style.opacity = '0'), 350);
}

function updateBadge(label) {
  const b = document.getElementById('gesture-badge');
  if (b) { b.textContent = '✋ ' + label.toUpperCase(); b.classList.add('live'); }
}

function highlightZone(zone) {
  const zones = document.querySelectorAll('#lanes-hint .zone');
  zones.forEach((z, i) => z.classList.toggle('active', i === zone));
}

async function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const res = landmarker.detectForVideo(video, performance.now());
      const lms = res?.landmarks?.[0];
      if (lms) {
        drawHand(lms);
        handleLandmarks(lms);
      } else {
        octx?.clearRect(0, 0, overlay.width, overlay.height);
        poseStreak.open = 0; poseStreak.fist = 0;
      }
    } catch (e) { /* ignore per-frame errors */ }
  }
  rafId = requestAnimationFrame(loop);
}

function handleLandmarks(lm) {
  const now = performance.now();
  const wrist = lm[0];
  history.push({ x: wrist.x, y: wrist.y, t: now });
  while (history.length > 0 && now - history[0].t > 350) history.shift();

  const ext = countExtendedFingers(lm);
  const isOpen = ext >= 4;
  const isFist = ext <= 1;
  poseStreak.open = isOpen ? poseStreak.open + 1 : 0;
  poseStreak.fist = isFist ? poseStreak.fist + 1 : 0;

  // --- swipe detection ---
  if (history.length >= 3) {
    const old = history[0];
    const dx = wrist.x - old.x; // mirrored? video is mirrored via CSS only, landmarks are raw: moving hand right decreases? keep raw but flip for UX
    const dy = wrist.y - old.y;
    const fdx = -dx; // flip because preview is mirrored
    const adx = Math.abs(fdx), ady = Math.abs(dy);
    if (Math.max(adx, ady) > swipeThreshold) {
      if (adx > ady * 1.2) fire(fdx < 0 ? 'left' : 'right');
      else if (ady > adx * 1.1) fire(dy < 0 ? 'up' : 'down');
      history.length = 0;
    }
  }

  // --- positional lane control (left/center/right zones) ---
  const zone = wrist.x < 0.38 ? 0 : wrist.x > 0.62 ? 2 : 1; // raw coords (not mirrored): camera sees flipped, so flip
  const flippedZone = 2 - zone;
  highlightZone(flippedZone);
  if (posControlEnabled && flippedZone !== lastZone) {
    if (flippedZone === 0 && lastZone !== 0) fire('left', ' (pos)');
    if (flippedZone === 2 && lastZone !== 2) fire('right', ' (pos)');
    if (flippedZone === 1) { /* recenter, no action */ }
    lastZone = flippedZone;
  } else if (!posControlEnabled) {
    lastZone = flippedZone;
  }

  // --- static poses: open palm = jump, fist = slide (need streak to debounce) ---
  if (poseStreak.open >= 4 && now - cooldowns.jumpPose > 900) {
    cooldowns.jumpPose = now;
    showToast('🖐️');
    callbacks.onUp?.();
    updateBadge('jump (palm)');
    poseStreak.open = 0;
  }
  if (poseStreak.fist >= 4 && now - cooldowns.slidePose > 900) {
    cooldowns.slidePose = now;
    showToast('✊');
    callbacks.onDown?.();
    updateBadge('slide (fist)');
    poseStreak.fist = 0;
  }

  const zoneName = ['LEFT', 'CENTER', 'RIGHT'][flippedZone];
  setStatus(`✋ Hand detected &nbsp;•&nbsp; fingers: <b>${ext}</b> ${isOpen ? '🖐️ JUMP' : isFist ? '✊ SLIDE' : ''}<br/>zone: <b>${zoneName}</b> &nbsp;•&nbsp; swipes: ◀ ▶ ▲ ▼`);
}

export async function initGestures(cb, opts = {}) {
  callbacks = cb;
  video = opts.video || document.getElementById('cam');
  overlay = opts.overlay || document.getElementById('hand-overlay');
  statusEl = opts.statusEl || document.getElementById('gesture-status');
  octx = overlay?.getContext('2d');

  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  landmarker = null;
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (gpuErr) {
    console.warn('[gesture] GPU delegate failed, retrying with CPU:', gpuErr);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
  return true;
}

export async function startCamera() {
  if (!landmarker) throw new Error('Gesture model not loaded yet');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  video.srcObject = stream;
  await video.play();
  running = true;
  loop();
  setStatus('✋ Tracking… show palm 🖐️ = jump, fist ✊ = slide, move hand ◀ ▶ to switch lanes');
}

export function stopCamera() {
  running = false;
  cancelAnimationFrame(rafId);
  video?.srcObject?.getTracks()?.forEach((t) => t.stop());
}

export function setSensitivity(v) { swipeThreshold = v; }
export function setPosControl(v) { posControlEnabled = v; }
export function isRunning() { return running; }
