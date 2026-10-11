import { Bowl, Pan, BN, PN, scoreRun, clamp, sstep, lerp } from './sim.js';
import { EggSurface, drawStoveBackground, drawBurner, drawPan, drawButter, Wisps, drawLog, roundRect, hash } from './render.js';
import { Plate } from './plate.js';
import { Sound } from './audio.js';
import { fetchBoard, submitScore } from './net.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const cv = $('#cv');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
const sound = new Sound();
const surface = new EggSurface();
const wisps = new Wisps();
let plate = null; // built lazily (needs a DOM canvas)

const S = {
  step: 'idle', // idle | beat | cook | plate | cut | reveal | result
  name: '',
  bowl: null, pan: null,
  t: 0,
  pointer: { x: 0, y: 0, down: false, vx: 0, vy: 0, lastT: 0, inside: false },
  tiltKey: 0,
  rollAnim: 0, rollKick: 0,
  plateT: 0,
  slitPath: [],
  result: null,
  submitted: false,
  shake: 0,
};
try { S.name = localStorage.getItem('omu-name') || ''; } catch {}

/* ------------------------------------------------------------------ */
/* Window chrome                                                       */
/* ------------------------------------------------------------------ */

let zTop = 20;
function openWin(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.hidden = false;
  w.style.zIndex = ++zTop;
  focusWin(w);
  if (id === 'win-board') loadBoard();
  if (id === 'win-main') w.hidden = false;
}
function closeWin(id) {
  const w = document.getElementById(id);
  if (w) w.hidden = true;
}
function focusWin(w) {
  $$('.window').forEach(x => x.classList.toggle('inactive', x !== w));
  w.style.zIndex = ++zTop;
}
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) { openWin(o.dataset.open); closeStart(); }
  const c = e.target.closest('[data-close]');
  if (c) closeWin(c.dataset.close);
  const a = e.target.closest('[data-act]');
  if (a && a.dataset.act === 'new') { closeStart(); newTrial(); }
  const m = e.target.closest('[data-min]');
  if (m) { /* the main window doesn't really minimise; it just stays put */ focusWin($('#win-main')); }
});
$$('.window').forEach(w => w.addEventListener('pointerdown', () => focusWin(w)));

// Drag windows by their title bars (desktop only).
$$('.window .titlebar').forEach(tb => {
  tb.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || window.innerWidth < 760) return;
    const w = tb.closest('.window');
    const r = w.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    w.style.transform = 'none';
    w.style.left = r.left + 'px'; w.style.top = r.top + 'px';
    tb.setPointerCapture(e.pointerId);
    const mv = ev => {
      w.style.left = clamp(ev.clientX - dx, -r.width + 80, window.innerWidth - 80) + 'px';
      w.style.top = clamp(ev.clientY - dy, 0, window.innerHeight - 60) + 'px';
    };
    const up = () => { tb.removeEventListener('pointermove', mv); tb.removeEventListener('pointerup', up); };
    tb.addEventListener('pointermove', mv);
    tb.addEventListener('pointerup', up);
  });
});

// Start menu.
const startMenu = document.createElement('div');
startMenu.className = 'startmenu raised window';
startMenu.hidden = true;
startMenu.innerHTML = `<div class="side"><b>Omurice</b>95</div><ul>
  <li><button data-act="new"><span class="tb-ico ico-egg"></span>New trial</button></li>
  <li><button data-open="win-board"><span class="tb-ico ico-trophy"></span>Hall of Fame</button></li>
  <li><button data-open="win-notes"><span class="tb-ico ico-note"></span>Chef's notes</button></li>
  <li><hr></li>
  <li><button id="sm-shut">Shut down…</button></li></ul>`;
document.body.appendChild(startMenu);
const startBtn = $('#start');
startBtn.setAttribute('aria-expanded', 'false');
startBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = startMenu.hidden;
  startMenu.hidden = !open;
  startBtn.setAttribute('aria-expanded', String(open));
  startMenu.style.zIndex = 99;
});
function closeStart() { startMenu.hidden = true; startBtn.setAttribute('aria-expanded', 'false'); }
document.addEventListener('pointerdown', e => { if (!startMenu.contains(e.target) && e.target !== startBtn && !startBtn.contains(e.target)) closeStart(); });
$('#sm-shut').addEventListener('click', () => { closeStart(); setStatus('Nice try. Nobody leaves the kitchen during a trial.'); });

function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
tickClock(); setInterval(tickClock, 15000);

// Sound toggle.
const muteBtn = $('#mute');
function syncMute() { muteBtn.textContent = 'Sound: ' + (sound.muted ? 'Off' : 'On'); muteBtn.setAttribute('aria-pressed', String(sound.muted)); }
muteBtn.addEventListener('click', () => { sound.init(); sound.setMuted(!sound.muted); syncMute(); });
syncMute();

function setStatus(t) { $('#status').textContent = t; }
function banner(t) {
  const b = $('#banner');
  if (!t) { b.hidden = true; return; }
  b.textContent = t; b.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Application form                                                    */
/* ------------------------------------------------------------------ */

const nameIn = $('#name');
nameIn.value = S.name;
$('#apply-form').addEventListener('submit', e => {
  e.preventDefault();
  const n = nameIn.value.trim().replace(/\s+/g, ' ');
  const err = $('#name-err');
  if (n.length < 2) { err.textContent = 'Please enter at least 2 characters.'; err.hidden = false; return; }
  if (!/^[\p{L}\p{N} _.@\-']+$/u.test(n)) { err.textContent = 'Letters, numbers, spaces and _ . @ - only.'; err.hidden = false; return; }
  err.hidden = true;
  S.name = n;
  try { localStorage.setItem('omu-name', n); } catch {}
  $('#who').textContent = 'Applicant: ' + n;
  closeWin('win-apply');
  sound.init();
  startBeat();
});

function newTrial() {
  closeWin('win-result');
  S.step = 'idle';
  showPanel('beat');
  setSteps('beat');
  openWin('win-main');
  openWin('win-apply');
  setTimeout(() => nameIn.focus(), 50);
}

/* ------------------------------------------------------------------ */
/* Stage plumbing                                                      */
/* ------------------------------------------------------------------ */

function showPanel(p) {
  $$('#panel > [data-panel]').forEach(el => (el.hidden = el.dataset.panel !== p));
}
function setSteps(cur) {
  const order = ['beat', 'cook', 'plate', 'cut'];
  const ci = order.indexOf(cur);
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('now', i === ci);
    li.classList.toggle('done', ci > i || cur === 'done');
  });
}

// Canvas pointer -> canvas pixels.
function canvasPt(e) {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
}

/* ---------------- 1. Beat ---------------- */

const BOWL = { cx: 300, cy: 245, r: 200 };
const bowlCell = () => (BOWL.r * 0.86 * 2) / (BN * 0.46 * 2);
function toBowl(x, y) {
  const s = bowlCell();
  return [(x - BOWL.cx) / s + (BN - 1) / 2, (y - BOWL.cy) / s + (BN - 1) / 2];
}

function startBeat() {
  S.bowl = new Bowl((Math.random() * 1e9) | 0);
  S.pan = new Pan((Math.random() * 1e9) | 0);
  S.step = 'beat';
  S.t = 0;
  S.submitted = false;
  S.result = null;
  plate = null;
  $('#egg-n').textContent = '(0/3)';
  $('#b-crack').disabled = false;
  $('#b-to-cook').disabled = true;
  $('#shell-warn').hidden = true;
  $('#m-mix i').style.width = '0%';
  showPanel('beat'); setSteps('beat');
  setStatus('Crack three eggs into the bowl.');
  banner('Crack 3 eggs, then beat them smooth');
}

function crackEgg(x, y) {
  const b = S.bowl;
  if (!b || b.eggs >= 3) return;
  const [gx, gy] = x != null ? toBowl(x, y) : [(BN - 1) / 2 + (Math.random() - 0.5) * 18, (BN - 1) / 2 + (Math.random() - 0.5) * 18];
  const res = b.crack(gx, gy);
  sound.crack();
  setTimeout(() => sound.plop(), 120);
  $('#egg-n').textContent = `(${b.eggs}/3)`;
  if (res && res.shell) { $('#shell-warn').hidden = false; setStatus('Oops. A piece of shell went in. Tap it to fish it out.'); }
  if (b.eggs === 3) {
    $('#b-crack').disabled = true;
    $('#b-to-cook').disabled = false;
    banner('Drag in fast circles to beat');
    if (!b.shells.length) setStatus('Beat until there are no streaks of white.');
  }
}
$('#b-crack').addEventListener('click', () => { sound.init(); crackEgg(); });
$('#b-to-cook').addEventListener('click', startCook);

/* ---------------- 2. Cook ---------------- */

const PANG = { cx: 300, cy: 222, r: 196 };
const panCell = () => (PANG.r * 2) / (S.pan.R * 2);
function panSquash() { return 1 - S.pan.tiltY * 0.14; }
function toPan(x, y) {
  const s = panCell();
  const cy = PANG.cy - S.pan.tiltY * 10;
  return [(x - PANG.cx) / s + S.pan.c, ((y - cy) / panSquash()) / s + S.pan.c];
}

function startCook() {
  S.step = 'cook';
  S.cookStart = performance.now();
  showPanel('cook'); setSteps('cook');
  $('#b-pour').disabled = false;
  $('#b-tap').disabled = true;
  $('#b-to-plate').disabled = true;
  $('#tilt').value = 0;
  $$('input[name=knob]').forEach(r => (r.checked = r.value === '0'));
  S.pan.setKnob(0);
  banner('Heat the pan, butter it, pour, scramble, roll');
  setStatus('Burner is off. The pan is cold.');
}

$$('input[name=knob]').forEach(r => r.addEventListener('change', () => { sound.init(); if (S.pan) S.pan.setKnob(+r.value); }));
$('#b-butter').addEventListener('click', () => {
  sound.init();
  if (!S.pan || S.pan.poured) return;
  if (S.pan.addButter()) { sound.plop(); if (S.pan.T > 110) sound.sizzle(1, 1); }
  $('#b-butter').textContent = `Add butter (${S.pan.butter} g in pan)`;
});
$('#b-pour').addEventListener('click', () => {
  sound.init();
  if (!S.pan || S.pan.poured) return;
  S.pan.startPour(S.bowl);
  $('#b-pour').disabled = true;
  $('#b-butter').disabled = true;
  $('#b-tap').disabled = false;
  $('#b-to-plate').disabled = false;
  banner('Drag in the pan to stir with chopsticks');
  setTimeout(() => { if (S.step === 'cook') banner(''); }, 3500);
});
const tiltIn = $('#tilt');
tiltIn.addEventListener('input', () => { if (S.pan) S.pan.tiltY = +tiltIn.value / 100; });
$('#b-tap').addEventListener('click', doTap);
function doTap() {
  if (S.step !== 'cook' || !S.pan) return;
  const r = S.pan.tap();
  sound.tap();
  S.shake = 1;
  if (!r.ok) {
    if (r.why === 'flat') setStatus('*thunk* The pan has to be tilted away from you for the egg to roll.');
    return;
  }
  S.rollKick = 1;
  if (r.tear > 0.25) setStatus('Rrrip. The skin tore. It was too wet underneath.');
  else if (r.crease > 0.25) setStatus('It cracked as it folded. The egg is getting firm.');
  else if (r.R >= 1) setStatus('Rolled into a football. Get it onto the rice.');
  else setStatus('It folds over itself… keep tapping.');
}
$('#b-to-plate').addEventListener('click', startPlate);

/* ---------------- 3. Plate ---------------- */

function startPlate() {
  const pan = S.pan;
  S.finalAgg = pan.aggregate();
  S.leftPanAt = S.t;
  S.step = 'plate';
  pan.setKnob(0);
  showPanel('plate'); setSteps('plate');
  if (!plate) plate = new Plate(W, H);
  const R = pan.rollR;
  S.omeletteSpec = {
    Lh: 70 * (0.82 + 0.18 * R), r0: lerp(13, 21, R), w0: lerp(56, 30, R),
    dm: S.finalAgg.dm, br: S.finalAgg.br, cu: (pan.stats.atRoll || S.finalAgg).cu,
    tears: pan.tears, creases: pan.creases,
  };
  plate.omelette = null;
  plate.update(0);
  banner('Click on the rice to slide the omelette off');
  setStatus(R < 0.4 ? 'It never got rolled. It slides off as a flat omelette.' : 'Aim for the middle of the rice.');
  sound.hiss(0); sound.sizzle(0, 0);
}

function placeOmelette(x, y) {
  const [gx, gy] = plate.unproject(x, y);
  const off = Math.hypot(gx, gy);
  // Nudge: it can't land beyond the rice edge entirely.
  const lim = 24;
  const px = clamp(gx, -lim, lim), py = clamp(gy, -lim, lim);
  plate.place({ x: px, y: py, ...S.omeletteSpec });
  S.plateOffset = off;
  sound.plop();
  S.step = 'cut-wait';
  setTimeout(() => {
    S.step = 'cut';
    showPanel('cut'); setSteps('cut');
    banner('Drag the knife along the top, tip to tip');
    setStatus('One cut only.');
  }, 650);
}

/* ---------------- 4. Cut & reveal ---------------- */

function finishCut() {
  const path = S.slitPath;
  S.slitPath = [];
  if (path.length < 4) return;
  const o = plate.omelette;
  const us = [], vs = [];
  for (const [gx, gy] of path) {
    const [u, v] = plate.toOmeletteFrame(gx, gy);
    if (Math.abs(u) < 1.05 && Math.abs(v) < o.w0 + 8) { us.push(clamp(u, -1, 1)); vs.push(v); }
  }
  if (us.length < 3) {
    plate.clearCut();
    setStatus('You missed the omelette. Cut along the top of it.');
    return;
  }
  const u0 = Math.min(...us), u1 = Math.max(...us);
  const mv = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mv) ** 2, 0) / vs.length);
  S.slit = { u0, u1, off: mv, offset: mv, wobble: sd, cover: clamp((u1 - u0) / 1.7, 0, 1) };
  // Carry-over cooking while it sat on the rice.
  const rest = S.t - S.leftPanAt;
  S.dmFinal = S.finalAgg.dm + Math.min(0.06, rest * 0.004);
  plate.omelette.dm = S.dmFinal;
  plate.cut(S.slit);
  sound.knife();
  S.step = 'reveal';
  S.revealT = 0;
  banner('');
  setStatus('…');
}

function finishTrial() {
  S.step = 'result';
  setSteps('done');
  const res = scoreRun({
    mix: S.bowl.mixedness(), foam: S.bowl.foamLevel(), shells: S.pan.shellsInEgg,
    pan: S.pan, plate: { offset: S.plateOffset }, slit: S.slit, dmFinal: S.dmFinal, rolledR: S.pan.rollR,
  });
  S.result = res;
  showResult(res);
}

function verdictLine(score) {
  if (score > 90) return 'Chef Okada nods once. "Start Monday. Bring your own chopsticks."';
  if (score >= 85) return '"Close. Very close. Come back next week and do it again."';
  if (score >= 70) return '"You can cook. That wasn\'t this omelette, though."';
  if (score >= 50) return '"We\'ll keep your application on file."';
  return '"Have you considered the front of house?"';
}

function showResult(res) {
  const hired = res.total > 90;
  $('#r-score').textContent = res.total;
  const st = $('#r-stamp');
  st.textContent = hired ? 'HIRED' : 'NOT HIRED';
  st.className = 'stamp ' + (hired ? 'hired' : 'rejected');
  $('#r-line').textContent = verdictLine(res.total);
  const rows = $('#r-rows');
  rows.innerHTML = '';
  for (const l of res.lines) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = l.label;
    const b = document.createElement('td'); b.textContent = `${Math.round(l.pts)}/${l.max}`;
    const c = document.createElement('td'); c.textContent = l.note;
    tr.append(a, b, c); rows.appendChild(tr);
  }
  const su = document.getElementById('share-url');
  const url = (su && su.dataset.url) || location.origin + '/';
  const text = hired
    ? `I scored ${res.total}/100 on the omurice line-cook trial at Hanjuku-tei and got HIRED 🍳`
    : `I scored ${res.total}/100 on the omurice line-cook trial at Hanjuku-tei. Not hired 🥲 Can you make the perfect split-open omelette?`;
  $('#r-share').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  $('#r-rank').textContent = 'Sending your score to the Hall of Fame…';
  hired ? sound.tada() : sound.fail();
  setTimeout(() => openWin('win-result'), 300);
  if (!S.submitted) {
    S.submitted = true;
    const breakdown = Object.fromEntries(res.lines.map(l => [l.key, Math.round(l.pts)]));
    submitScore({ name: S.name, score: res.total, breakdown }).then(r => {
      if (r.online && r.rank) $('#r-rank').textContent = `You're #${r.rank} of ${r.of} applicants in the Hall of Fame.`;
      else if (r.online) $('#r-rank').textContent = 'Score saved to the Hall of Fame.';
      else $('#r-rank').textContent = 'This score couldn\'t be posted to the Hall of Fame from here. It\'s saved on this computer.';
    });
  }
}

/* ---------------- Leaderboard ---------------- */

async function loadBoard() {
  const body = $('#board-rows');
  body.innerHTML = '<tr><td colspan="4" class="muted">Loading scores…</td></tr>';
  const { online, entries } = await fetchBoard();
  body.innerHTML = '';
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="4" class="muted">No applicants yet. Be the first.</td></tr>';
  }
  entries.slice(0, 100).forEach((e, i) => {
    const tr = document.createElement('tr');
    if (S.name && e.name.toLowerCase() === S.name.toLowerCase()) tr.className = 'me';
    const cells = [String(i + 1), e.name, String(e.score), e.score > 90 ? 'HIRED' : 'Not hired'];
    cells.forEach((c, k) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (k === 0 || k === 2) td.className = 'num';
      if (k === 3) td.className = e.score > 90 ? 'tag-h' : 'tag-r';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $('#board-note').textContent = online ? 'Best score per applicant. Over 90 = hired.' : 'Offline: showing scores from this computer only.';
}
$('#b-board-refresh').addEventListener('click', loadBoard);

/* ------------------------------------------------------------------ */
/* Input on the canvas                                                 */
/* ------------------------------------------------------------------ */

cv.addEventListener('pointerdown', e => {
  sound.init();
  cv.setPointerCapture(e.pointerId);
  const [x, y] = canvasPt(e);
  const P = S.pointer;
  P.x = x; P.y = y; P.down = true; P.vx = 0; P.vy = 0; P.lastT = performance.now(); P.downX = x; P.downY = y;
  if (S.step === 'beat') {
    const b = S.bowl;
    const [gx, gy] = toBowl(x, y);
    if (b.removeShellAt(gx, gy)) {
      sound.ding();
      setStatus(b.shells.length ? 'Got one. There\'s more shell in there.' : 'Shell out. Keep beating.');
      if (!b.shells.length) $('#shell-warn').hidden = true;
      P.down = false;
      return;
    }
    if (b.eggs < 3) { crackEgg(x, y); P.down = false; }
  } else if (S.step === 'plate') {
    placeOmelette(x, y);
    P.down = false;
  } else if (S.step === 'cut') {
    S.slitPath = [];
    plate.clearCut();
    addSlitPoint(x, y);
  }
});
cv.addEventListener('pointermove', e => {
  const [x, y] = canvasPt(e);
  const P = S.pointer;
  const now = performance.now();
  const dt = Math.max(1, now - P.lastT) / 1000;
  // Smoothed pointer velocity in canvas px/s.
  P.vx = lerp(P.vx, (x - P.x) / dt, 0.5);
  P.vy = lerp(P.vy, (y - P.y) / dt, 0.5);
  const px = P.x, py = P.y;
  P.x = x; P.y = y; P.lastT = now; P.inside = true;
  if (!P.down) return;
  if (S.step === 'beat' && S.bowl.eggs > 0) {
    const s = bowlCell();
    // Apply along the segment so fast strokes don't skip.
    const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 10));
    for (let i = 1; i <= steps; i++) {
      const [gx, gy] = toBowl(lerp(px, x, i / steps), lerp(py, y, i / steps));
      S.bowl.whisk(gx, gy, P.vx / s, P.vy / s, dt / steps);
    }
    if (Math.random() < 0.25) sound.burst(0.04, 1500 + Math.random() * 1500, 3, 0.08);
  } else if (S.step === 'cook' && S.pan.poured) {
    const s = panCell();
    const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 8));
    let w = 0;
    for (let i = 1; i <= steps; i++) {
      const [gx, gy] = toPan(lerp(px, x, i / steps), lerp(py, y, i / steps));
      w += S.pan.stir(gx, gy, P.vx / s, P.vy / s, dt / steps);
    }
    if (w > 0 && Math.random() < 0.3) sound.scrape();
  } else if (S.step === 'cut') {
    addSlitPoint(x, y);
  }
});
const endPointer = () => {
  const P = S.pointer;
  if (P.down && S.step === 'cut') finishCut();
  P.down = false;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { S.pointer.inside = false; });

function addSlitPoint(x, y) {
  const [gx, gy] = plate.unproject(x, y);
  const prev = S.slitPath[S.slitPath.length - 1];
  S.slitPath.push([gx, gy]);
  if (prev) plate.markCut(gx, gy, prev[0], prev[1]); else plate.markCut(gx, gy);
}

document.addEventListener('keydown', e => {
  if (e.target.closest('input[type=text], input:not([type]), textarea')) return;
  if (S.step === 'cook') {
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) doTap(); }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); S.tiltKey = 1; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); S.tiltKey = -1; }
    if (/^Digit[0-3]$/.test(e.code)) {
      const k = +e.code.slice(5);
      S.pan.setKnob(k);
      $$('input[name=knob]').forEach(r => (r.checked = +r.value === k));
    }
  }
});
document.addEventListener('keyup', e => {
  if (['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS'].includes(e.code)) S.tiltKey = 0;
});

/* ------------------------------------------------------------------ */
/* Frame loop                                                          */
/* ------------------------------------------------------------------ */

let last = performance.now(), acc = 0;
const DT = 1 / 60;
function frame(now) {
  const el = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += el;
  let n = 0;
  while (acc >= DT && n < 4) { update(DT); acc -= DT; n++; }
  if (n === 4) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

let lastStatusKey = '';
function update(dt) {
  S.t += dt;
  wisps.step(dt);
  if (S.step === 'beat' && S.bowl) {
    S.bowl.step(dt);
    if (S.bowl.eggs === 3) {
      const m = S.bowl.mixedness();
      $('#m-mix i').style.width = Math.round(m * 100) + '%';
    }
  }
  if ((S.step === 'cook' || S.step === 'plate') && S.pan) {
    const pan = S.pan;
    if (S.tiltKey) {
      pan.tiltY = clamp(pan.tiltY + S.tiltKey * dt * 2.2, 0, 1);
      tiltIn.value = Math.round(pan.tiltY * 100);
    }
    if (S.step === 'cook') pan.step(dt);
    S.rollAnim += (pan.rollR - S.rollAnim) * Math.min(1, dt * 9);
    S.rollKick = Math.max(0, S.rollKick - dt * 4);
    S.shake = Math.max(0, S.shake - dt * 6);
    // Sizzle: loud on a hot pan with wet egg or water in the butter.
    const agg = pan._lastAgg || { mass: 0, dm: 0, cover: 0 };
    const wet = pan.poured ? agg.cover * (1 - sstep(0.4, 1, agg.dm)) * 1.1 + 0.15 : pan.butter && pan.butterMelt > 0.3 ? pan.butterWater * 0.9 + 0.15 : 0;
    const heat = sstep(95, 190, pan.T);
    if (S.step === 'cook') {
      sound.sizzle(wet * heat, pan.butterState() === 'foaming' ? 0.4 : heat * wet * 0.4);
      sound.hiss(pan.knob ? 0.3 + pan.knob * 0.25 : 0);
    }
    // Steam and smoke.
    if (pan.poured && pan.T > 105 && Math.random() < 0.5 * heat) wisps.emit(PANG.cx, PANG.cy, 'steam', 1, 110);
    if (pan.smoke > 0 && Math.random() < pan.smoke) wisps.emit(PANG.cx, PANG.cy, 'smoke', 1, 60);
    if (S.step === 'cook') {
      // Readouts.
      const lcd = $('#lcd-t');
      const T = Math.round(pan.T);
      if (lcd.textContent !== String(T)) lcd.textContent = T;
      const box = lcd.parentElement;
      box.classList.toggle('hot', pan.T > 195 && pan.T <= 225);
      box.classList.toggle('burn', pan.T > 225);
      $('#cook-t').textContent = pan.cookTime().toFixed(1) + ' s';
      const key = statusFor(pan, agg);
      if (key && key !== lastStatusKey) { lastStatusKey = key; setStatus(key); }
    }
  }
  if (S.step === 'plate' || S.step === 'cut' || S.step === 'cut-wait' || S.step === 'reveal' || S.step === 'result') {
    plate.update(dt);
    if (S.step === 'reveal') {
      S.revealT += dt;
      if (S.revealT > 4.2) finishTrial();
    }
  }
}

// What the cook would notice right now: sight, sound, smell.
function statusFor(pan, agg) {
  if (!pan.poured) {
    const st = pan.butterState();
    if (pan.smoke > 0.3) return 'Smoke is coming off the pan!';
    if (st === 'burnt') return 'The butter has burnt black.';
    if (st === 'brown') return 'The butter is turning brown and smells nutty.';
    if (st === 'foaming') return 'The butter is foaming and crackling.';
    if (st === 'clear' && pan.butterBrown < 0.1) return 'The foam is dying down. The butter has gone clear.';
    if (st === 'melting') return pan.T < 40 ? 'The butter is just sitting there. The pan is cold.' : 'The butter is melting.';
    if (st === 'melted') return 'Melted butter, but no sizzle yet.';
    if (!pan.knob) return pan.T > 60 ? 'Burner off. The pan is cooling.' : 'Burner is off. The pan is cold.';
    if (pan.T < 100) return 'The pan is warming up.';
    if (pan.T < 170) return 'The pan is getting hot.';
    if (pan.T < 230) return 'The pan is very hot.';
    return 'The pan is ripping hot.';
  }
  if (pan.pouring) return 'Pouring…';
  if (pan.rolling) return null;
  if (pan.T < 105) return 'No sizzle. The egg is just sitting in a warm pan.';
  if (agg.dm < 0.12) return 'Raw egg, sizzling at the edges.';
  if (agg.dm < 0.3) return agg.cu > 0.2 ? 'Soft curds forming. Top still very wet.' : 'Bottom is setting. Top is still raw.';
  if (agg.dm < 0.45) return 'Like wet scrambled egg. The bottom is setting into a skin.';
  if (agg.dm < 0.6) return 'Set underneath, glossy and soft on top.';
  if (agg.dm < 0.78) return 'The top has nearly set.';
  return 'It\'s cooked through and getting rubbery.';
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function draw() {
  if (S.step === 'idle') return drawIdle();
  if (S.step === 'beat') return drawBeat();
  if (S.step === 'cook') return drawCook();
  return drawPlate();
}

function drawIdle() {
  drawStoveBackground(ctx, W, H, S.t);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd23f';
  ctx.font = '600 44px "Pixelify Sans", Tahoma, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('OMURICE.EXE', W / 2, H / 2 - 10);
  ctx.fillStyle = '#ddd';
  ctx.font = '16px Tahoma, sans-serif';
  ctx.fillText('Hanjuku-tei line cook trial', W / 2, H / 2 + 22);
  ctx.textAlign = 'start';
}

function drawCounter() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#6b5a45'); g.addColorStop(1, '#4a3d2e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Butcher block strips.
  for (let x = 0; x < W; x += 46) {
    ctx.fillStyle = (x / 46) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x, 0, 46, H);
  }
}

function drawBeat() {
  const b = S.bowl;
  drawCounter();
  const { cx, cy, r } = BOWL;
  // Bowl: white ceramic with a blue band.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(cx + 8, cy + 14, r * 1.02, r * 1.02, 0, 0, Math.PI * 2); ctx.fill();
  const bg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.8, '#e9e9e4'); bg.addColorStop(1, '#bdbdb5');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2e4fa8'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, r - 9, 0, Math.PI * 2); ctx.stroke();
  const ig = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 0.88);
  ig.addColorStop(0, '#f4f2ea'); ig.addColorStop(1, '#cfcdc4');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2); ctx.fill();
  if (b.eggs > 0) {
    // Liquid surface.
    const N = BN;
    const h = new Float32Array(N * N);
    const yk = new Float32Array(N * N);
    for (let k = 0; k < h.length; k++) {
      if (!b.mask[k]) continue;
      h[k] = 6 + b.foam[k] * 0.6;
      yk[k] = b.yk[k] * b.norm;
    }
    // Intact yolks stand up as domes.
    for (const Y of b.yolks) {
      if (Y.intact <= 0) continue;
      for (let j = Math.floor(Y.y - Y.r); j <= Math.ceil(Y.y + Y.r); j++) for (let i = Math.floor(Y.x - Y.r); i <= Math.ceil(Y.x + Y.r); i++) {
        const d = Math.hypot(i - Y.x, j - Y.y);
        if (d < Y.r && b.mask[j * N + i]) h[j * N + i] += Math.sqrt(1 - (d / Y.r) ** 2) * 4 * Y.intact;
      }
    }
    const img = surface.draw({ N, h, yk }, { relief: 1.2 });
    const s = bowlCell();
    const half = ((N - 1) / 2) * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, b.R * s - 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, cx - half, cy - half, (N - 1) * s, (N - 1) * s);
    // Foam: little bubbles wherever it was whipped hard.
    ctx.fillStyle = 'rgba(255,255,250,0.55)';
    for (let i = 0; i < 700; i++) {
      const gx = hash(i) * N, gy = hash(i + 1000) * N;
      const f = b.foam[(gy | 0) * N + (gx | 0)];
      if (!f || hash(i + 2000) > f * 3) continue;
      ctx.beginPath(); ctx.arc(cx + (gx - (N - 1) / 2) * s, cy + (gy - (N - 1) / 2) * s, 1.2 + hash(i + 3000) * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // Shell fragments.
    for (const sh of b.shells) {
      const x = cx + (sh.x - (N - 1) / 2) * s, y = cy + (sh.y - (N - 1) / 2) * s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(sh.rot);
      ctx.fillStyle = '#f7efe2'; ctx.strokeStyle = '#a89a83'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(3, -8); ctx.lineTo(10, -1); ctx.lineTo(4, 7); ctx.lineTo(-7, 5); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '15px Tahoma, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Click the bowl to crack an egg', cx, cy);
    ctx.textAlign = 'start';
  }
  // Chopsticks follow the pointer.
  if (S.pointer.inside && b.eggs > 0) drawChopsticks(S.pointer.x, S.pointer.y, S.pointer.down);
}

function drawChopsticks(x, y, down) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.7);
  for (const o of [-5, 5]) {
    const g = ctx.createLinearGradient(0, o - 3, 0, o + 3);
    g.addColorStop(0, '#d8b07a'); g.addColorStop(1, '#9c7041');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, o * (down ? 0.4 : 1) - 2); ctx.lineTo(260, o * 2.4 - 4); ctx.lineTo(260, o * 2.4 + 4); ctx.lineTo(0, o * (down ? 0.4 : 1) + 2);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawCook() {
  const pan = S.pan;
  drawStoveBackground(ctx, W, H, S.t);
  const { cx, r } = PANG;
  const shake = S.shake * Math.sin(S.t * 80) * 3;
  const cy = PANG.cy - pan.tiltY * 10 + shake;
  drawBurner(ctx, cx, PANG.cy + 6, r * 1.05, pan.knob, S.t);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, panSquash());
  ctx.translate(-cx, -cy);
  drawPan(ctx, cx, cy, r, pan.tiltY, pan.T);
  const s = panCell();
  drawButter(ctx, pan, cx, cy, s / 4.8, S.t);
  if (pan.poured) {
    const img = surface.draw(pan, { time: S.t });
    const N = pan.N;
    const half = pan.c * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (pan.rolling) {
      // Only the part not yet rolled stays flat; the log sits on top.
      const a = pan.stats.atRoll;
      const jLog = pan.c - pan.R * 0.52;
      const jStart = Math.min(a.maxJ, pan.c + pan.R * 0.8);
      const jCut = lerp(jStart, jLog, S.rollAnim);
      const yCut = cy + (jCut - pan.c) * s;
      ctx.beginPath(); ctx.rect(cx - r, cy - r, r * 2, yCut - (cy - r)); ctx.clip();
      ctx.globalAlpha = 1 - S.rollAnim * 0.85;
      ctx.drawImage(img, cx - half, cy - half, (N - 1) * s, (N - 1) * s);
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.save();
      const chord = 2 * Math.sqrt(Math.max(0, pan.R ** 2 - (jCut - pan.c) ** 2)) * s;
      const len = Math.min(chord * 0.86, r * 1.5) * (0.6 + 0.4 * Math.min(1, S.rollAnim * 1.6));
      const rad = lerp(8, 54, Math.sqrt(S.rollAnim));
      const agg = pan._lastAgg || pan.aggregate();
      const br = clamp(agg.br, 0, 1);
      const ext = { r: Math.round(lerp(252, 190, br)), g: Math.round(lerp(222, 130, br)), b: Math.round(lerp(110, 55, br)) };
      drawLog(ctx, cx, yCut - S.rollKick * 6, len, rad, ext, pan.tears, pan.creases, S.rollAnim * 3 + S.rollKick, S.t);
    } else {
      ctx.drawImage(img, cx - half, cy - half, (N - 1) * s, (N - 1) * s);
    }
    ctx.restore();
  }
  ctx.restore();
  // Pour stream from the bowl.
  if (pan.pouring) {
    const px = cx + (pan.pourX - pan.c) * s, py = cy + (pan.pourY - pan.c) * s;
    const g = ctx.createLinearGradient(px, 0, px + 12, 0);
    g.addColorStop(0, 'rgba(250,180,40,0.9)'); g.addColorStop(1, 'rgba(255,215,90,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(px - 4, 0); ctx.quadraticCurveTo(px - 8 + Math.sin(S.t * 20) * 2, py * 0.5, px - 6, py);
    ctx.lineTo(px + 6, py); ctx.quadraticCurveTo(px + 8, py * 0.5, px + 10, 0); ctx.fill();
  }
  wisps.draw(ctx);
  if (S.pointer.inside && pan.poured && !pan.rolling) drawChopsticks(S.pointer.x, S.pointer.y, S.pointer.down);
}

function drawPlate() {
  plate.render(ctx);
  if (S.step === 'plate' && S.pointer.inside) {
    // Ghost of where it'll land.
    const [gx, gy] = plate.unproject(S.pointer.x, S.pointer.y);
    const sp = S.omeletteSpec;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffe27a';
    ctx.strokeStyle = '#000'; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const u = Math.cos(a), v = Math.sin(a) * sp.w0 * Math.pow(Math.max(0, 1 - u * u), 0.27);
      const [x, y] = plate.project(gx + u * sp.Lh, gy + v, plate.heightAt(gx + u * sp.Lh, gy + v) + 8);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  if (S.step === 'cut' && plate.omelette && S.pointer.inside) drawKnife(S.pointer.x, S.pointer.y);
  // Steam off a fresh omelette.
  if (plate.omelette && Math.random() < 0.15) {
    const [x, y] = plate.project(plate.omelette.x, plate.omelette.y, 60);
    wisps.emit(x, y, 'steam', 1, 40);
  }
  wisps.draw(ctx);
}

function drawKnife(x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.35);
  // Blade.
  const g = ctx.createLinearGradient(0, -14, 0, 4);
  g.addColorStop(0, '#f4f6f8'); g.addColorStop(0.6, '#b9c0c7'); g.addColorStop(1, '#7c858e');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(130, -6); ctx.lineTo(130, -24); ctx.quadraticCurveTo(40, -24, 0, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  // Handle.
  ctx.fillStyle = '#2b1d14';
  roundRect(ctx, 128, -22, 80, 16, 5); ctx.fill();
  ctx.fillStyle = '#c9c9c9';
  ctx.fillRect(150, -16, 4, 4); ctx.fillRect(180, -16, 4, 4);
  ctx.restore();
}

/* ------------------------------------------------------------------ */

// Handy for poking at the game from the browser console.
window.__omu = { S, get plate() { return plate; }, startPlate, placeOmelette, finishCut };

newTrial();
requestAnimationFrame(frame);
// Preload the board quietly so the first open is fast.
fetchBoard();
