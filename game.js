// game.js — Subway Dash: pseudo-3D endless runner + gestures (lazy-loaded, file:// safe)
let G = null;
async function loadGestures() {
  if (!G) G = await import('./gesture.js');
  return G;
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const CX = W / 2, HORIZON = H * 0.30, PLAYER_Y = H * 0.90;
const LANES = [-1, 0, 1];
const MAX_DIST = 1.0;

/* ================= AUDIO (WebAudio, no assets) ================= */
const SFX = {
  ctx: null,
  enabled: localStorage.getItem('subway-dash-muted') !== '1',
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.15, slideTo = 0) {
    if (!this.enabled) return;
    this.ensure(); if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  click() { this.tone(600, 0.07, 'square', 0.06); },
  jump() { this.tone(280, 0.22, 'sine', 0.14, 640); },
  slide() { this.tone(500, 0.2, 'sawtooth', 0.07, 120); },
  coin() { this.tone(950, 0.09, 'square', 0.07); setTimeout(() => this.tone(1420, 0.14, 'square', 0.07), 60); },
  power() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.12), i * 70)); },
  crash() { this.tone(160, 0.5, 'sawtooth', 0.2, 40); },
  count(final) { this.tone(final ? 880 : 440, final ? 0.35 : 0.15, 'square', 0.1); },
  near() { this.tone(1200, 0.08, 'sine', 0.06, 1800); },
};

/* ================= STATE ================= */
const state = {
  mode: 'menu', // menu | countdown | playing | over | paused
  score: 0, coins: 0, dist: 0,
  best: +(localStorage.getItem('subway-dash-best') || 0),
  newBest: false,
  speed: 1, baseSpeed: 0.22, time: 0,
  obstacles: [], coinRows: [], powerups: [], particles: [], popups: [],
  spawnT: 0, invulnT: 0, powerT: 12, shake: 0,
  countT: 0, countLast: 4,
  magnetT: 0, multT: 0, shield: false,
  lamps: [], clouds: [],
};
for (let i = 0; i < 10; i++) state.lamps.push({ off: i / 10 });
for (let i = 0; i < 5; i++) state.clouds.push({ x: Math.random(), y: 0.04 + Math.random() * 0.14, s: 0.5 + Math.random() });

const player = { lane: 1, x: 0, jumpY: 0, jumpV: 0, jumping: false, sliding: 0, runPhase: 0 };

function reset() {
  Object.assign(state, {
    score: 0, coins: 0, dist: 0, newBest: false, speed: 1, time: 0,
    obstacles: [], coinRows: [], powerups: [], particles: [], popups: [],
    spawnT: 0.8, invulnT: 0, powerT: 10, shake: 0,
    magnetT: 0, multT: 0, shield: false,
  });
  Object.assign(player, { lane: 1, x: 0, jumpY: 0, jumpV: 0, jumping: false, sliding: 0, runPhase: 0 });
  renderPowerHUD();
  const cd = document.getElementById('countdown');
  if (cd) cd.textContent = '3';
}

/* ================= CONTROLS ================= */
function goLeft() { if (state.mode !== 'playing') return; if (player.lane > 0) { player.lane--; SFX.ensure(); } }
function goRight() { if (state.mode !== 'playing') return; if (player.lane < 2) { player.lane++; SFX.ensure(); } }
function doJump() {
  if (state.mode !== 'playing') return;
  if (!player.jumping && player.sliding <= 0) { player.jumping = true; player.jumpV = 1.9; SFX.jump(); puff(playerScreen().x, playerScreen().y, 6, '#9ca3af'); }
}
function doSlide() {
  if (state.mode !== 'playing') return;
  if (!player.jumping) { if (player.sliding <= 0) SFX.slide(); player.sliding = 0.75; }
  else player.jumpV = Math.min(player.jumpV, -1.6);
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') goLeft();
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') goRight();
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') doJump();
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') doSlide();
  else if (e.key === 'p' || e.key === 'P') togglePause();
  else if (e.key === 'm' || e.key === 'M') toggleMute();
  else if (e.key === 'r' || e.key === 'R') { if (state.mode === 'over') startGame(); }
});
let tsx = 0, tsy = 0;
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; tsx = t.clientX; tsy = t.clientY; }, { passive: true });
canvas.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - tsx, dy = t.clientY - tsy;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { doJump(); return; }
  if (Math.abs(dx) > Math.abs(dy)) dx < 0 ? goLeft() : goRight();
  else dy < 0 ? doJump() : doSlide();
}, { passive: true });
document.querySelectorAll('#touch button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); SFX.ensure(); ({ left: goLeft, right: goRight, up: doJump, down: doSlide })[b.dataset.act](); });
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'playing') togglePause(); });

/* ================= SPAWNING ================= */
const OB_TYPES = ['low', 'high', 'train'];
function spawnRow() {
  const r = Math.random();
  const nBlock = r < 0.4 ? 1 : 2;
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, nBlock);
  for (const lane of lanes) {
    let type = OB_TYPES[(Math.random() * OB_TYPES.length) | 0];
    if (type === 'train' && Math.random() < 0.35) { // long train: 2 segments
      state.obstacles.push({ lane, dist: MAX_DIST, type: 'train' });
      state.obstacles.push({ lane, dist: MAX_DIST + 0.13, type: 'train' });
    } else {
      state.obstacles.push({ lane, dist: MAX_DIST, type });
    }
    if (type === 'low' && Math.random() < 0.6) { // coin arc over the barrier — jump to grab
      for (let i = 0; i < 5; i++) state.coinRows.push({ lane, dist: MAX_DIST - 0.1 + i * 0.05, h: 0.62 });
    }
  }
  const free = [0, 1, 2].find((l) => !lanes.includes(l));
  if (free !== undefined && Math.random() < 0.7) {
    for (let i = 0; i < 5; i++) state.coinRows.push({ lane: free, dist: MAX_DIST + i * 0.055, h: 0 });
  }
  // rare express train with warning (single lane only, always escapable)
  if (state.time > 25 && Math.random() < 0.16) {
    const lane = (Math.random() * 3) | 0;
    state.obstacles.push({ lane, dist: MAX_DIST + 0.35, type: 'express' });
    popup(CX, H * 0.45, '⚠ EXPRESS TRAIN!', '#f87171');
  }
}
function spawnPowerup() {
  const kinds = ['magnet', 'shield', 'mult'];
  const kind = kinds[(Math.random() * kinds.length) | 0];
  state.powerups.push({ lane: (Math.random() * 3) | 0, dist: MAX_DIST + 0.2, kind, bob: Math.random() * 6 });
}

/* ================= UPDATE ================= */
function update(dt) {
  state.time += dt;
  state.speed = 1 + state.time / 50;
  const spd = state.baseSpeed * state.speed;
  const mult = state.multT > 0 ? 2 : 1;
  state.score += dt * 10 * state.speed * mult;
  state.dist += spd * dt * 60;
  if (state.invulnT > 0) state.invulnT -= dt;
  if (state.magnetT > 0) state.magnetT -= dt;
  if (state.multT > 0) state.multT -= dt;

  const targetX = LANES[player.lane];
  player.x += (targetX - player.x) * Math.min(1, dt * 12);
  player.runPhase += dt * (9 + state.speed * 5);

  if (player.jumping) {
    const wasFalling = player.jumpV < 0;
    player.jumpY += player.jumpV * dt;
    player.jumpV -= 5.4 * dt;
    if (player.jumpY <= 0) {
      player.jumpY = 0; player.jumping = false;
      puff(playerScreen().x, playerScreen().y, 8, '#9ca3af'); // landing poof
    } else if (!wasFalling && player.jumpV < 0) { /* apex */ }
  }
  if (player.sliding > 0) {
    player.sliding -= dt;
    if (Math.random() < 0.5) spark(playerScreen().x + (Math.random() - 0.5) * 30, playerScreen().y - 4, '#fdba74');
  }
  if (!player.jumping && player.sliding <= 0 && Math.random() < dt * 8) {
    puff(playerScreen().x + (Math.random() - 0.5) * 20, playerScreen().y, 1, 'rgba(156,163,184,.5)'); // run dust
  }

  state.spawnT -= dt * state.speed;
  if (state.spawnT <= 0) { spawnRow(); state.spawnT = Math.max(0.45, 0.95 + Math.random() * 0.65 - state.time / 150); }
  state.powerT -= dt;
  if (state.powerT <= 0) { spawnPowerup(); state.powerT = 14 + Math.random() * 8; }

  const dz = (spd * dt) / 1.2;
  for (const o of state.obstacles) o.dist -= dz * (o.type === 'express' ? 1.9 : 1);
  for (const c of state.coinRows) c.dist -= dz;
  for (const p of state.powerups) { p.dist -= dz; p.bob += dt * 4; }

  // magnet: drift coins toward player
  if (state.magnetT > 0) {
    for (const c of state.coinRows) {
      if (c.dist < 0.35 && c.dist > -0.02) {
        if (c.lane !== player.lane && Math.random() < 0.25) c.lane += Math.sign(player.lane - c.lane);
        c.dist -= dt * 0.35;
      }
    }
  }

  // pickups
  const pp = playerScreen();
  for (const c of state.coinRows) {
    if (c.taken) continue;
    const sameLane = c.lane === player.lane;
    const close = c.dist < 0.08 && c.dist > -0.03;
    if (c.h > 0) { // arc coins need air
      if (sameLane && close && player.jumpY > 0.2) { c.taken = true; state.coins++; SFX.coin(); burst(pp.x, pp.y - 70, '#fde68a'); }
    } else if (sameLane && close && player.jumpY < 0.6) { c.taken = true; state.coins++; SFX.coin(); burst(pp.x, pp.y - 70, '#fde68a'); }
    else if (state.magnetT > 0 && c.dist < 0.16 && c.dist > -0.03 && Math.abs(c.lane - player.lane) <= 1 && player.jumpY < 0.6) {
      c.taken = true; state.coins++; SFX.coin(); burst(pp.x, pp.y - 70, '#fde68a');
    }
  }
  state.coinRows = state.coinRows.filter((c) => !c.taken && c.dist > -0.08);
  for (const p of state.powerups) {
    if (!p.taken && p.dist < 0.08 && p.dist > -0.03 && p.lane === player.lane) {
      p.taken = true; SFX.power();
      if (p.kind === 'magnet') { state.magnetT = 8; popup(pp.x, pp.y - 120, '🧲 COIN MAGNET!', '#60a5fa'); }
      else if (p.kind === 'shield') { state.shield = true; popup(pp.x, pp.y - 120, '🛡 SHIELD UP!', '#4ade80'); }
      else { state.multT = 8; popup(pp.x, pp.y - 120, '✨ 2x SCORE!', '#c084fc'); }
      burst(pp.x, pp.y - 80, '#fff');
    }
  }
  state.powerups = state.powerups.filter((p) => !p.taken && p.dist > -0.08);

  // collisions
  if (state.invulnT <= 0) {
    for (const o of state.obstacles) {
      if (o.dist < 0.075 && o.dist > -0.02 && o.lane === player.lane) {
        let hit = false;
        if (o.type === 'train' || o.type === 'express') hit = player.jumpY < 0.9;
        else if (o.type === 'low') hit = player.jumpY < 0.28;
        else if (o.type === 'high') hit = player.sliding <= 0;
        if (hit) {
          if (state.shield) { // shield absorbs: clear the threat, keep running
            state.shield = false; state.invulnT = 1.6; state.shake = 0.5;
            state.obstacles = state.obstacles.filter((k) => !(k.lane === o.lane && k.dist < 0.3));
            popup(pp.x, pp.y - 130, '🛡 SAVED!', '#4ade80');
            SFX.power(); burst(pp.x, pp.y - 60, '#4ade80');
          } else { gameOver(); return; }
        }
      }
      // near-miss bonus: dodged a train in adjacent lane while passing
      if (!o.passed && (o.type === 'train' || o.type === 'express') && o.dist < -0.02) {
        o.passed = true;
        if (Math.abs(player.x - LANES[o.lane]) < 1.4) {
          state.score += 25 * mult; SFX.near();
          popup(pp.x, pp.y - 150, 'CLOSE! +25', '#fde68a');
        }
      }
    }
    // side-swipe into a train mid lane-change
    for (const o of state.obstacles) {
      if ((o.type === 'train' || o.type === 'express') && o.dist < 0.06 && o.dist > -0.02 &&
          o.lane !== player.lane && Math.abs(player.x - LANES[o.lane]) < 0.28 && player.jumpY < 0.5) {
        if (state.shield) {
          state.shield = false; state.invulnT = 1.6; state.shake = 0.5;
          state.obstacles = state.obstacles.filter((k) => !(k.lane === o.lane && k.dist < 0.3));
          popup(pp.x, pp.y - 130, '🛡 SAVED!', '#4ade80'); SFX.power();
        } else { gameOver(); return; }
      }
    }
  }
  state.obstacles = state.obstacles.filter((o) => o.dist > -0.1);

  for (const p of state.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.life -= dt; }
  state.particles = state.particles.filter((p) => p.life > 0);
  for (const p of state.popups) { p.y -= 34 * dt; p.life -= dt; }
  state.popups = state.popups.filter((p) => p.life > 0);

  // clouds drift
  for (const c of state.clouds) { c.x += dt * 0.004 * c.s; if (c.x > 1.15) { c.x = -0.15; c.y = 0.04 + Math.random() * 0.14; } }

  if (state.shake > 0) state.shake -= dt;
  renderPowerHUD();
}

/* ================= PARTICLES / POPUPS ================= */
function burst(x, y, c) {
  for (let i = 0; i < 12; i++) state.particles.push({ x, y, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 260 - 40, life: 0.55, c });
}
function puff(x, y, n, c) {
  for (let i = 0; i < n; i++) state.particles.push({ x: x + (Math.random() - 0.5) * 24, y: y - Math.random() * 6, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 60, life: 0.4, c });
}
function spark(x, y, c) { state.particles.push({ x, y, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 120, life: 0.3, c }); }
function popup(x, y, text, color) { state.popups.push({ x, y, text, color: color || '#fff', life: 1.2 }); }

/* ================= PROJECTION ================= */
function project(laneUnit, dist) {
  const persp = Math.max(0, 1 - dist);
  const e = Math.pow(persp, 1.6);
  return {
    x: CX + laneUnit * (W * 0.36) * (0.12 + 0.88 * e),
    y: HORIZON + (PLAYER_Y - HORIZON) * e,
    s: 0.12 + 0.88 * e,
  };
}
function playerScreen() {
  const p = project(player.x, 0);
  return { x: p.x, y: p.y - player.jumpY * 260 };
}

/* ================= RENDER ================= */
function draw() {
  ctx.save();
  if (state.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * state.shake * 8, (Math.random() - 0.5) * 10 * state.shake * 8);

  // --- night sky ---
  let g = ctx.createLinearGradient(0, 0, 0, HORIZON);
  g.addColorStop(0, '#070b24'); g.addColorStop(0.6, '#1b1447'); g.addColorStop(1, '#42237a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HORIZON + 1);
  // stars
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 127.3) % W, sy = (i * 71.7) % (HORIZON * 0.8);
    if ((i + (state.time | 0)) % 5 !== 0) ctx.fillRect(sx, sy, 1.5, 1.5);
  }
  // moon + glow
  const mg = ctx.createRadialGradient(W * 0.82, H * 0.09, 4, W * 0.82, H * 0.09, 60);
  mg.addColorStop(0, 'rgba(253,230,138,.9)'); mg.addColorStop(0.25, 'rgba(253,230,138,.35)'); mg.addColorStop(1, 'rgba(253,230,138,0)');
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(W * 0.82, H * 0.09, 60, 0, 7); ctx.fill();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(W * 0.82, H * 0.09, 22, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(180,160,90,.5)'; ctx.beginPath(); ctx.arc(W * 0.75, H * 0.085, 5, 0, 7); ctx.arc(W * 0.86, H * 0.1, 3.5, 0, 7); ctx.fill();
  // clouds
  ctx.fillStyle = 'rgba(120,130,190,.28)';
  for (const c of state.clouds) {
    const cxp = c.x * W, cyp = c.y * H;
    ctx.beginPath(); ctx.ellipse(cxp, cyp, 46 * c.s, 10 * c.s, 0, 0, 7); ctx.ellipse(cxp + 26 * c.s, cyp + 3, 30 * c.s, 8 * c.s, 0, 0, 7); ctx.fill();
  }
  // far skyline (slow parallax) + near buildings (fast)
  drawSkyline(0.25, 90, '#141b3d');
  drawSkyline(0.6, 130, '#0d1330');

  // --- ground ---
  g = ctx.createLinearGradient(0, HORIZON, 0, H);
  g.addColorStop(0, '#232c44'); g.addColorStop(0.25, '#1a2135'); g.addColorStop(1, '#0d1222');
  ctx.fillStyle = g; ctx.fillRect(0, HORIZON, W, H - HORIZON);
  // side platforms
  ctx.fillStyle = '#2b3550';
  const plL = project(-1.9, 0), plLf = project(-1.9, 1), plR = project(1.9, 0), plRf = project(1.9, 1);
  ctx.beginPath(); ctx.moveTo(0, PLAYER_Y); ctx.lineTo(plL.x, plL.y); ctx.lineTo(plLf.x, plLf.y); ctx.lineTo(0, HORIZON); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(W, PLAYER_Y); ctx.lineTo(plR.x, plR.y); ctx.lineTo(plRf.x, plRf.y); ctx.lineTo(W, HORIZON); ctx.closePath(); ctx.fill();
  // platform edge lights rushing by
  for (let i = 0; i < 8; i++) {
    const d = (i / 8 + (state.time * state.baseSpeed * state.speed * 1.5) % 1) % 1;
    for (const side of [-1.75, 1.75]) {
      const p = project(side, 1 - d);
      ctx.fillStyle = 'rgba(250,204,21,.8)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 * p.s + 1, 0, 7); ctx.fill();
    }
  }
  // lamp posts with light cones
  for (const lamp of state.lamps) {
    const d = (lamp.off + (state.time * state.baseSpeed * state.speed * 1.5) % 1) % 1;
    for (const side of [-1, 1]) {
      const p = project(side * 1.7, 1 - d);
      const h = 130 * p.s;
      ctx.strokeStyle = '#0b0f1f'; ctx.lineWidth = Math.max(1, 5 * p.s);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - h); ctx.stroke();
      const lg = ctx.createRadialGradient(p.x, p.y - h, 1, p.x, p.y - h, 60 * p.s);
      lg.addColorStop(0, 'rgba(253,224,71,.85)'); lg.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(p.x, p.y - h, 60 * p.s, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(253,224,71,.10)';
      ctx.beginPath(); ctx.moveTo(p.x - 6 * p.s, p.y - h); ctx.lineTo(p.x + 6 * p.s, p.y - h); ctx.lineTo(p.x + 34 * p.s, p.y); ctx.lineTo(p.x - 34 * p.s, p.y); ctx.closePath(); ctx.fill();
    }
  }
  // ballast speckles
  ctx.fillStyle = 'rgba(148,163,184,.25)';
  for (let i = 0; i < 60; i++) {
    const d = ((i * 0.37) + (state.time * state.baseSpeed * state.speed * 1.5) % 1) % 1;
    const p = project(((i * 0.731) % 2) - 1, 1 - d);
    ctx.fillRect(p.x, p.y, 2, 2);
  }
  // rails (3 tracks) + sleepers
  for (let l = -1; l <= 1; l++) {
    for (const off of [-0.09, 0.09]) {
      ctx.strokeStyle = 'rgba(203,213,225,.55)'; ctx.lineWidth = 2;
      ctx.beginPath();
      const a = project(l + off, 1), b = project(l + off, 0);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(120,113,108,.6)';
  for (let i = 0; i < 14; i++) {
    const d = ((i / 14) + (state.time * state.baseSpeed * state.speed * 1.5) % 1) % 1;
    const p = project(0, 1 - d);
    ctx.fillRect(p.x - W * 0.42 * p.s, p.y - 2, W * 0.84 * p.s, 2.5 * p.s + 1);
  }

  // coins / powerups / obstacles far->near
  for (const c of [...state.coinRows].sort((a, b) => b.dist - a.dist)) drawCoin(c);
  for (const p of [...state.powerups].sort((a, b) => b.dist - a.dist)) drawPowerup(p);
  for (const o of [...state.obstacles].sort((a, b) => b.dist - a.dist)) drawObstacle(o);

  drawPlayer();

  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;

  // popups
  ctx.textAlign = 'center';
  for (const p of state.popups) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.font = 'bold 17px sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(p.text, p.x, p.y); ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // speed lines + vignette
  if (state.speed > 1.5 && state.mode === 'playing') {
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const y = Math.random() * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(40 + Math.random() * 70, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W, y); ctx.lineTo(W - 40 - Math.random() * 70, y); ctx.stroke();
    }
  }
  const vg = ctx.createRadialGradient(CX, H / 2, H * 0.35, CX, H / 2, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  document.getElementById('score').textContent = Math.floor(state.score);
  document.getElementById('coins').textContent = '🪙 ' + state.coins;
  document.getElementById('speed').textContent = state.speed.toFixed(1) + 'x' + (state.multT > 0 ? ' ✨' : '');
  document.getElementById('dist').textContent = Math.floor(state.dist) + 'm';
}

function drawSkyline(par, maxH, color) {
  ctx.fillStyle = color;
  const off = (state.time * 4 * par) % 120;
  for (let x = -120; x < W + 120; x += 60) {
    const bx = x - off;
    const bh = 40 + ((x * 7919) % 100 + 100) % 100 / 100 * maxH;
    ctx.fillRect(bx, HORIZON - bh * 0.5, 44, bh * 0.5);
  }
  ctx.fillStyle = 'rgba(250,204,21,.35)';
  for (let x = -120; x < W + 120; x += 60) {
    const bx = x - off;
    const bh = 40 + ((x * 7919) % 100 + 100) % 100 / 100 * maxH;
    for (let wy = 0; wy < 3; wy++) ctx.fillRect(bx + 8 + ((x + wy * 13) % 2) * 16, HORIZON - bh * 0.5 + 6 + wy * 10, 6, 7);
  }
}

function drawCoin(c) {
  const p = project(LANES[c.lane], c.dist);
  const yBase = c.h > 0 ? 120 * p.s : 46 * p.s;
  const r = 11 * p.s + 2;
  const spin = Math.abs(Math.cos(state.time * 6 + c.dist * 20));
  const bobY = Math.sin(state.time * 3 + c.dist * 30) * 2;
  if (state.magnetT > 0) { // glow ring while magnet active
    ctx.strokeStyle = 'rgba(96,165,250,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - yBase + bobY, r + 5, (r + 5) * 0.8, 0, 0, 7); ctx.stroke();
  }
  ctx.fillStyle = '#b45309';
  ctx.beginPath(); ctx.ellipse(p.x + 1.5, p.y - yBase + bobY + 1.5, r, r * (0.3 + 0.7 * spin), 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.ellipse(p.x, p.y - yBase + bobY, r, r * (0.3 + 0.7 * spin), 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fde68a';
  ctx.beginPath(); ctx.ellipse(p.x, p.y - yBase + bobY, r * 0.55, r * 0.55 * (0.3 + 0.7 * spin), 0, 0, 7); ctx.fill();
}

const POWER_STYLE = {
  magnet: { bg: '#1d4ed8', fg: '#bfdbfe', icon: '🧲', label: 'MAGNET' },
  shield: { bg: '#15803d', fg: '#bbf7d0', icon: '🛡', label: 'SHIELD' },
  mult: { bg: '#7e22ce', fg: '#e9d5ff', icon: '✨', label: '2x' },
};
function drawPowerup(p) {
  const pr = project(LANES[p.lane], p.dist);
  const y = pr.y - 52 * pr.s + Math.sin(p.bob) * 5;
  const r = 17 * pr.s + 3;
  const st = POWER_STYLE[p.kind];
  const glow = ctx.createRadialGradient(pr.x, y, 1, pr.x, y, r + 10);
  glow.addColorStop(0, st.fg); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(pr.x, y, r + 10, 0, 7); ctx.fill();
  ctx.fillStyle = st.bg; ctx.beginPath(); ctx.arc(pr.x, y, r, 0, 7); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = st.fg; ctx.stroke();
  ctx.font = `${Math.max(10, 17 * pr.s + 3)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(st.icon, pr.x, y + 1);
  ctx.textBaseline = 'alphabetic';
}

function drawObstacle(o) {
  const p = project(LANES[o.lane], o.dist);
  const w = 92 * p.s;
  if (o.type === 'low') {
    const h = 46 * p.s + 4;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(p.x - w / 2 + 3, p.y - h + 4, w, h);
    ctx.fillStyle = '#c2410c'; ctx.fillRect(p.x - w / 2, p.y - h, w, h);
    ctx.fillStyle = '#f97316'; ctx.fillRect(p.x - w / 2, p.y - h, w, h * 0.45);
    ctx.fillStyle = '#fff';
    const stripeW = w / 8, shift = (state.time * 30 * p.s) % (stripeW * 2);
    for (let x = -stripeW * 2; x < w + stripeW; x += stripeW * 2) ctx.fillRect(p.x - w / 2 + x + shift, p.y - h, stripeW, h);
    ctx.fillStyle = '#431407';
    ctx.fillRect(p.x - w / 2 - 4, p.y - h - 7, w + 8, 9);
    ctx.fillRect(p.x - w / 2, p.y - h - 7, 6, h + 7); ctx.fillRect(p.x + w / 2 - 6, p.y - h - 7, 6, h + 7);
    ctx.fillStyle = '#fef3c7'; ctx.font = `bold ${Math.max(8, 14 * p.s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('▲ JUMP ▲', p.x, p.y - h - 11);
  } else if (o.type === 'high') {
    const topH = 62 * p.s + 6, gapH = 54 * p.s + 8;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(p.x - w / 2 + 3, p.y - topH - gapH + 4, w, topH + gapH);
    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(p.x - w / 2, p.y - topH - gapH, 9 * p.s + 2, topH + gapH);
    ctx.fillRect(p.x + w / 2 - 9 * p.s - 2, p.y - topH - gapH, 9 * p.s + 2, topH + gapH);
    ctx.fillStyle = '#0369a1'; ctx.fillRect(p.x - w / 2, p.y - topH - gapH, w, topH);
    ctx.fillStyle = '#38bdf8'; ctx.fillRect(p.x - w / 2, p.y - topH - gapH, w, topH * 0.4);
    ctx.fillStyle = '#e0f2fe';
    for (let i = 0; i < 4; i++) ctx.fillRect(p.x - w / 2 + 8 + i * (w - 16) / 4, p.y - gapH - 16 * p.s, (w - 16) / 4 - 8, 8 * p.s + 2);
    ctx.fillStyle = '#fef9c3'; ctx.font = `bold ${Math.max(8, 14 * p.s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('▼ SLIDE ▼', p.x, p.y - gapH - 20 * p.s);
    // hanging sign sway
    const sway = Math.sin(state.time * 2 + o.lane) * 2 * p.s;
    ctx.fillStyle = '#facc15'; ctx.fillRect(p.x - 20 * p.s + sway, p.y - gapH + 4, 40 * p.s, 12 * p.s);
    ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(7, 10 * p.s)}px sans-serif`;
    ctx.fillText('MIND YOUR HEAD', p.x + sway, p.y - gapH + 13 * p.s);
  } else {
    // train / express front
    const express = o.type === 'express';
    const h = 152 * p.s + 8;
    const colors = ['#dc2626', '#2563eb', '#16a34a'];
    const col = express ? '#7c3aed' : colors[o.lane] || '#dc2626';
    if (express && Math.floor(state.time * 6) % 2 === 0) {
      ctx.strokeStyle = 'rgba(248,113,113,.9)'; ctx.lineWidth = 3;
      ctx.strokeRect(p.x - w / 2 - 4, p.y - h - 4, w + 8, h + 8);
    }
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(p.x - w / 2 + 5, p.y - h + 9, w, h);
    const bodyG = ctx.createLinearGradient(p.x - w / 2, 0, p.x + w / 2, 0);
    bodyG.addColorStop(0, shade(col, -30)); bodyG.addColorStop(0.5, col); bodyG.addColorStop(1, shade(col, -30));
    ctx.fillStyle = bodyG;
    roundRect(p.x - w / 2, p.y - h, w, h, 9 * p.s); ctx.fill();
    // roof + pantograph spark
    ctx.fillStyle = shade(col, -45); ctx.fillRect(p.x - w / 2, p.y - h, w, 12 * p.s);
    if (Math.random() < 0.06) spark(p.x + (Math.random() - 0.5) * w * 0.5, p.y - h, '#fef08a');
    // windshield with driver silhouette
    ctx.fillStyle = '#0b1526';
    roundRect(p.x - w / 2 + 8 * p.s, p.y - h + 16 * p.s, w - 16 * p.s, 36 * p.s, 5 * p.s); ctx.fill();
    const wg = ctx.createLinearGradient(0, p.y - h + 16 * p.s, 0, p.y - h + 52 * p.s);
    wg.addColorStop(0, 'rgba(186,230,253,.85)'); wg.addColorStop(1, 'rgba(186,230,253,.15)');
    ctx.fillStyle = wg;
    roundRect(p.x - w / 2 + 11 * p.s, p.y - h + 19 * p.s, w - 22 * p.s, 30 * p.s, 4 * p.s); ctx.fill();
    ctx.fillStyle = '#0b1526';
    ctx.beginPath(); ctx.arc(p.x + 8 * p.s, p.y - h + 40 * p.s, 8 * p.s, 0, 7); ctx.fill(); // driver head
    // route number + stripe
    ctx.fillStyle = '#f8fafc'; ctx.font = `bold ${Math.max(9, 16 * p.s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(express ? 'EXP' : ['101', '202', '303'][o.lane] || '404', p.x, p.y - h + 72 * p.s);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(p.x - w / 2, p.y - 52 * p.s, w, 7 * p.s);
    // grille + headlights with glow
    ctx.fillStyle = '#111827';
    for (let i = 0; i < 4; i++) ctx.fillRect(p.x - w / 2 + 10 * p.s + i * (w - 20 * p.s) / 4, p.y - 36 * p.s, (w - 20 * p.s) / 4 - 6 * p.s, 14 * p.s);
    for (const s of [-1, 1]) {
      const lx = p.x + s * w * 0.28, ly = p.y - 18 * p.s, lr = 7 * p.s + 1;
      const hg = ctx.createRadialGradient(lx, ly, 1, lx, ly, lr + 14 * p.s);
      hg.addColorStop(0, 'rgba(254,240,138,1)'); hg.addColorStop(1, 'rgba(254,240,138,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(lx, ly, lr + 14 * p.s, 0, 7); ctx.fill();
      ctx.fillStyle = '#fef9c3'; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 7); ctx.fill();
    }
  }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayer() {
  const base = project(player.x, 0);
  const x = base.x, groundY = base.y;
  const y = groundY - player.jumpY * 260;
  const s = base.s;
  const sliding = player.sliding > 0;
  const lean = (LANES[player.lane] - player.x) * 0.35; // lean into lane changes
  const blink = state.invulnT > 0 && Math.floor(state.time * 10) % 2 === 0;
  const run = Math.sin(player.runPhase) * (player.jumping ? 0.3 : 1);

  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(x, groundY + 5, 27 * s * (1 - player.jumpY * 0.35), 7, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = blink ? 0.45 : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.scale(s, s);
  const legSwing = run * 11;
  if (sliding) {
    // roll pose: tucked low
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.ellipse(0, -16, 24, 13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#facc15';
    roundRect2(-20, -30, 40, 20, 9); ctx.fill();
    ctx.fillStyle = '#fcd7b0'; ctx.beginPath(); ctx.arc(16, -26, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#0ea5e9'; ctx.fillRect(6, -36, 22, 6);
    ctx.fillStyle = '#111827';
    ctx.fillRect(-26, -14, 14, 9); ctx.fillRect(12, -14, 14, 9); // shoes
  } else if (player.jumping) {
    // tucked jump: knees up
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-13, -38, 10, 22); ctx.fillRect(4, -38, 10, 22);
    ctx.fillStyle = '#111827';
    ctx.fillRect(-14, -18, 12, 7); ctx.fillRect(3, -18, 12, 7);
    ctx.fillStyle = '#facc15'; roundRect2(-17, -80, 34, 44, 10); ctx.fill();
    ctx.fillStyle = '#eab308'; roundRect2(-17, -80, 34, 12, 8); ctx.fill(); // hood
    ctx.fillStyle = '#fcd7b0'; ctx.beginPath(); ctx.arc(0, -92, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#0ea5e9'; ctx.fillRect(-13, -106, 26, 9);
    ctx.fillStyle = '#0ea5e9'; ctx.fillRect(-13, -106, 26, 3);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(-26, -76, 8, 22); ctx.fillRect(18, -76, 8, 22); // arms out
  } else {
    // run cycle
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(-13, -36 + Math.max(0, legSwing), 10, 36 - Math.max(0, legSwing));
    ctx.fillRect(3, -36 + Math.max(0, -legSwing), 10, 36 - Math.max(0, -legSwing));
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-14, -10 + Math.max(0, legSwing), 12, 8);
    ctx.fillRect(2, -10 + Math.max(0, -legSwing), 12, 8);
    ctx.fillStyle = '#facc15'; roundRect2(-17, -80, 34, 46, 10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.15)'; roundRect2(-17, -44, 34, 10, 5); ctx.fill();
    ctx.fillStyle = '#f97316'; ctx.fillRect(-4, -76, 8, 10); // zipper
    ctx.fillStyle = '#fcd7b0'; ctx.beginPath(); ctx.arc(0, -93, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(5, -93, 2, 0, 7); ctx.fill(); // eye
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(-14, -107, 28, 9); ctx.fillRect(-14, -107, 28, 3);
    ctx.fillStyle = '#f97316';
    ctx.fillRect(-26, -72 + run * 5, 9, 24); ctx.fillRect(17, -72 - run * 5, 9, 24);
    ctx.fillStyle = '#fcd7b0';
    ctx.beginPath(); ctx.arc(-21, -46 + run * 5, 5, 0, 7); ctx.arc(21, -46 - run * 5, 5, 0, 7); ctx.fill();
  }
  ctx.restore();

  // shield ring
  if (state.shield) {
    ctx.strokeStyle = `rgba(74,222,128,${0.6 + 0.4 * Math.sin(state.time * 6)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y - 50 * s, 34 * s, 52 * s, 0, 0, 7); ctx.stroke();
  }
  // magnet aura
  if (state.magnetT > 0) {
    ctx.strokeStyle = 'rgba(96,165,250,.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 50 * s, 44 * s + Math.sin(state.time * 5) * 5, 0, 7); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function roundRect2(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================= POWER-UP HUD ================= */
function renderPowerHUD() {
  const el = document.getElementById('powerups');
  let html = '';
  if (state.magnetT > 0) html += `<span class="pu magnet">🧲 ${state.magnetT.toFixed(0)}s</span>`;
  if (state.multT > 0) html += `<span class="pu mult">✨ 2x ${state.multT.toFixed(0)}s</span>`;
  if (state.shield) html += `<span class="pu shield">🛡 SHIELD</span>`;
  el.innerHTML = html;
}

/* ================= FLOW ================= */
function startGame() {
  SFX.ensure(); SFX.click();
  reset();
  state.mode = 'countdown'; state.countT = 2.4; state.countLast = 4;
  for (const id of ['menu', 'gameover', 'paused']) document.getElementById(id).classList.add('hidden');
  document.getElementById('countdown').classList.remove('hidden');
}
function startPlaying() {
  state.mode = 'playing';
  document.getElementById('countdown').classList.add('hidden');
}
function gameOver() {
  if (state.mode !== 'playing') return;
  state.mode = 'over'; state.shake = 0.7; SFX.crash();
  const pp = playerScreen();
  burst(pp.x, pp.y - 60, '#ef4444'); burst(pp.x, pp.y - 60, '#facc15');
  const sc = Math.floor(state.score);
  state.newBest = sc > state.best;
  state.best = Math.max(state.best, sc);
  localStorage.setItem('subway-dash-best', state.best);
  document.getElementById('final-score').textContent = 'Score: ' + sc;
  document.getElementById('final-coins').textContent = '🪙 ' + state.coins + ' coins • ' + Math.floor(state.dist) + 'm';
  document.getElementById('best').textContent = (state.newBest ? '🎉 NEW BEST! ' : 'Best: ') + state.best;
  setTimeout(() => document.getElementById('gameover').classList.remove('hidden'), 650);
}
function togglePause() {
  SFX.click();
  if (state.mode === 'playing') { state.mode = 'paused'; document.getElementById('paused').classList.remove('hidden'); }
  else if (state.mode === 'paused') { state.mode = 'playing'; document.getElementById('paused').classList.add('hidden'); }
}
function toggleMute() {
  SFX.enabled = !SFX.enabled;
  localStorage.setItem('subway-dash-muted', SFX.enabled ? '0' : '1');
  document.getElementById('btn-mute').textContent = SFX.enabled ? '🔊' : '🔇';
}

document.getElementById('btn-retry').onclick = startGame;
document.getElementById('btn-menu').onclick = () => {
  SFX.click(); state.mode = 'menu';
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
};
document.getElementById('btn-resume').onclick = togglePause;
document.getElementById('btn-keyboard').onclick = () => startGame();
document.getElementById('btn-mute').onclick = toggleMute;
document.getElementById('btn-mute').textContent = SFX.enabled ? '🔊' : '🔇';

function gestureErrorMsg(err, where) {
  console.error('[gesture:' + where + ']', err);
  const name = err?.name || '', msg = String(err?.message || err);
  if (location.protocol === 'file:') return 'Blocked because you opened index.html directly (file://).\n\nFix: open http://localhost:8000 instead (double-click start_game.bat).';
  if (!window.isSecureContext) return 'Camera needs a secure context (localhost or HTTPS). You are on: ' + location.href;
  if (name === 'NotAllowedError') return 'Camera permission denied.\nClick the camera/lock icon in the address bar → Allow this site, then retry.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera found.\n• Desktop: plug in/enable the webcam.\n• Close apps using the camera (Zoom, Teams, Camera app).\n• Windows: Settings → Privacy & security → Camera → Camera access ON (+ Let desktop apps access your camera).\nKeyboard mode still works.';
  if (name === 'NotReadableError') return 'Camera is busy or frozen (opened but no video).\nClose Zoom/Teams/Camera app and any other tab using the camera, then retry.\nKeyboard mode still works.';
  if (name === 'NotSupportedError') return msg + '\nUse Chrome or Edge over HTTPS (the Vercel link is fine).';
  if (/failed to fetch|dynamically|import|network|cdn/i.test(msg)) return 'Could not download the hand-tracking model (internet/CDN blocked?). ' + msg;
  return 'Camera / hand tracking failed (' + where + '): ' + msg;
}
document.getElementById('btn-camera').onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'Loading hand model…';
  try {
    const g = await loadGestures();
    await g.initGestures({ onLeft: goLeft, onRight: goRight, onUp: doJump, onDown: doSlide });
    await g.startCamera();
    document.getElementById('gesture-badge').textContent = '✋ GESTURE LIVE';
    document.getElementById('gesture-badge').classList.add('live');
    document.getElementById('btn-cam-toggle').textContent = '⏹ Stop Camera';
    startGame();
  } catch (err) { alert(gestureErrorMsg(err, 'enable-and-play')); }
  finally { btn.disabled = false; btn.textContent = '📷 Enable Camera & Play'; }
};
document.getElementById('btn-cam-toggle').onclick = async (e) => {
  const btn = e.currentTarget; // capture now: e.currentTarget is null after await
  try {
    const g = await loadGestures();
    if (g.isRunning()) { g.stopCamera(); btn.textContent = '📷 Start Camera'; return; }
    btn.textContent = 'Loading…';
    await g.initGestures({ onLeft: goLeft, onRight: goRight, onUp: doJump, onDown: doSlide });
    await g.startCamera();
    e.currentTarget.textContent = '⏹ Stop Camera';
    document.getElementById('gesture-badge').textContent = '✋ GESTURE LIVE';
    document.getElementById('gesture-badge').classList.add('live');
    if (state.mode !== 'playing') startGame();
  } catch (err) { alert(gestureErrorMsg(err, 'toggle')); btn.textContent = '📷 Start Camera'; }
};
document.getElementById('sens').oninput = async (e) => { try { (await loadGestures()).setSensitivity(+e.target.value); } catch {} };
document.getElementById('chk-pos').onchange = async (e) => { try { (await loadGestures()).setPosControl(e.target.checked); } catch {} };
if (location.protocol === 'file:') {
  const st = document.getElementById('gesture-status');
  if (st) st.innerHTML = '⚠️ Opened via <b>file://</b> — keyboard works, but camera needs <b>http://localhost:8000</b>.<br/>Run <code>python -m http.server 8000</code> or double-click <b>start_game.bat</b>.';
}

/* ================= MAIN LOOP ================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === 'countdown') {
    state.time += dt * 0.25;
    player.runPhase += dt * 12;
    state.countT -= dt;
    const n = Math.ceil(state.countT);
    const el = document.getElementById('countdown');
    if (n !== state.countLast) {
      state.countLast = n;
      if (n > 0) { el.textContent = n; SFX.count(false); }
      else { el.textContent = 'GO!'; SFX.count(true); }
    }
    if (state.countT <= -0.5) startPlaying();
  } else if (state.mode === 'playing') {
    update(dt);
  }
  draw();
  requestAnimationFrame(frame);
}
reset();
state.mode = 'menu';
requestAnimationFrame(frame);
