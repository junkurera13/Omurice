# OMURICE.EXE

A Windows 95–style job trial at a fictional diner, Hanjuku-tei. You cook the
soft, split-open omurice omelette (Kichi Kichi / Tampopo style). Score over
90/100 and you're hired.

Play: https://claude.ai/artifact/88Ai2S2bCDgN763M9sPf1U

## How it works

- `js/sim.js`: the egg physics. Heightfield fluid for liquid egg, heat
  transfer from the pan, bottom-skin vs. bulk doneness, curds from stirring,
  browning, butter melting/foaming/browning, the roll, and the scoring.
- `js/render.js`: per-pixel shaded egg surface (glossy raw egg, matte set
  egg, curds), the pan, butter, flames, steam, the rolled omelette.
- `js/plate.js`: the ketchup rice and plate in a 3/4 voxel view; the
  omelette landing, the cut, and the opening (spring-damped, with run-off).
- `js/game.js`: the UI and game flow. `js/audio.js`: synthesised sounds.
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
