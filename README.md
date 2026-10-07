# Subway Dash — Gesture-Controlled Endless Runner

A Subway Surfers–style 3-lane endless runner that you control with **hand gestures** (webcam + MediaPipe, 100% local) or keyboard/touch.

**Live demo:** hosted on Vercel (HTTPS, so the camera works) — see repo About section for the URL.

## Gestures

| Action | Gesture | Alternative |
|--------|---------|-------------|
| ⬅️ Move left | Move hand to the left | Swipe left |
| ➡️ Move right | Move hand to the right | Swipe right |
| ⬆️ Jump | Open palm 🖐️ | Swipe up |
| ⬇️ Slide / roll | Fist ✊ | Swipe down |

Keyboard also always works: `← →` lanes, `↑ / Space` jump, `↓` slide, `P` pause, `R` retry.

## Run it locally (camera needs localhost or HTTPS!)

`file://` blocks the webcam, so serve the folder:

```powershell
cd "C:\Users\prave\OneDrive\Documents\gesture game"
python -m http.server 8000
```

Then open **http://localhost:8000** → click **📷 Enable Camera & Play** → allow camera.

## Deploy (Vercel)

Static site, no build step. Import the repo at [vercel.com/new](https://vercel.com/new), keep all defaults, and Deploy. `vercel.json` is already included.

No install needed — the hand-tracking model loads from CDN. No video ever leaves your browser.

## Files

- `index.html` — UI, HUD, overlays, camera preview
- `style.css` — subway-night theme
- `game.js` — runner: 3 lanes, trains, jump/slide barriers, coins, score, particles
- `gesture.js` — MediaPipe HandLandmarker: swipes + open-palm/fist + lane zones

## Tips

- One hand, good lighting, plain background works best.
- If lanes switch too easily, uncheck "Lane follow by hand position" and use only swipes, or raise swipe sensitivity slider value (less sensitive).
- Trains (tall, colored) must be dodged by changing lanes. Orange barriers → jump. Blue overhead → slide.
