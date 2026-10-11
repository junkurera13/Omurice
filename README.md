# OMURICE.EXE

A line-cook trial at a fictional diner, Hanjuku-tei: a 1930s rubber-hose
cartoon UI (Cuphead / Mouse: P.I. for Hire) around a realistic 3D kitchen
(three.js). Beat the eggs, scramble, tap them into a football, plate it,
and the head chef cuts it open. Score over 90/100 and you're hired.

Play: https://claude.ai/artifact/88Ai2S2bCDgN763M9sPf1U

## How it works

- `js/sim.js`: the egg physics. Heightfield fluid for liquid egg, heat
  transfer from the pan, bottom-skin vs. bulk doneness, curds from stirring,
  browning, butter melting/foaming/browning, the roll, and the scoring.
- `js/world.js`: renderer, lighting, camera moves. `js/textures.js`:
  procedural wood, skin and custard textures.
- `js/bowl3d.js`, `js/pan3d.js`: the bowl and the pan; the egg is a live
  deformable mesh driven by the sim, and the wrist-tap fold curls it into
  a spiral against the far lip.
- `js/plate3d.js`: instanced ketchup rice, the omelette, the head chef's
  knife, and the custard, a viscous fluid that runs as fast as its
  doneness allows.
- `js/chef.js`: Chef Okada, an SVG rubber-hose character.
- `js/game.js`: the game flow and UI. `js/audio.js`: synthesised sounds.
- `js/net.js`: leaderboard. Uses the Claude Artifact database when running
  as an Artifact, `api/scores.js` (Vercel Blob) when deployed on Vercel,
  otherwise this browser's storage.

## Run locally

    python3 -m http.server 8000   # then open http://localhost:8000

## Publish

- As a Claude Artifact: `python3 scripts/build-artifact.py OUT_DIR SHARE_URL`
  and publish `OUT_DIR/index.html` with the `js/` files.
- On Vercel: import this folder as a project (no framework, no build step),
  add a Blob store to the project, deploy. The leaderboard then uses
  `/api/scores`.
