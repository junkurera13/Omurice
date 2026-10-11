import * as THREE from '../vendor/three.module.min.js';
import { Bowl, Pan, scoreRun, clamp, sstep, lerp } from './sim.js';
import { World, SETS } from './world.js';
import { woodTexture } from './textures.js';
import { Stove, Pan3D, Chopsticks } from './pan3d.js';
import { Bowl3D } from './bowl3d.js';
import { Plate3D, surface } from './plate3d.js';
import { Chef } from './chef.js';
import { Sound } from './audio.js';
import { fetchBoard, submitScore } from './net.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const sound = new Sound();
const chef = new Chef($('#chef'), $('#bubble'));

// Camera spots, relative to each set's origin.
const VIEWS = {
  beat: { set: 'bowl', pos: V(0, 33, 27), at: V(0, 2, 0.5) },
  cook: { set: 'stove', pos: V(0, 44, 19), at: V(0, 2, -1.5) },
  fold: { set: 'stove', pos: V(-26, 21, 14), at: V(0, 3, -3.5) },
  plate: { set: 'plate', pos: V(-30, 32, 30), at: V(0, 5, -4) },
  judge: { set: 'plate', pos: V(-5, 21, 28), at: V(0, 3.6, 0.3) },
};
const viewPos = v => [v.pos.clone().add(SETS[v.set]), v.at.clone().add(SETS[v.set])];

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

let world, stove, pan3d, bowl3d, plate3d, bowlSticks, panSticks;
try {
  world = new World($('#gl'));
  const wood = woodTexture();
  wood.repeat.set(2, 2);
  bowl3d = new Bowl3D(world, SETS.bowl, wood);
  stove = new Stove(world, SETS.stove);
  pan3d = new Pan3D(world, stove);
  plate3d = new Plate3D(world, SETS.plate, wood);
  bowlSticks = new Chopsticks(bowl3d.group);
  panSticks = new Chopsticks(pan3d.group);
  const [p, t] = viewPos(VIEWS.cook);
  world.snapCamera(p.add(V(0, 8, 10)), t);
  world.setFocus(SETS.stove);
  bowl3d.group.visible = plate3d.group.visible = false;
  world.tameReflections();
  new ResizeObserver(() => world.resize()).observe($('#gl'));
} catch (e) {
  console.error(e);
  $('#loading').textContent = 'This browser can’t draw 3D (WebGL is off).';
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const S = {
  stage: 'title', handle: '', bowl: null, pan: null, t: 0,
  ptr: { down: false, last: null, lastT: 0, vx: 0, vy: 0 },
  tiltHeld: false, roll: 0, kick: 0, result: null, submitted: false,
  judgeT: 0, spec: null,
};
try { S.handle = localStorage.getItem('omu-handle') || ''; } catch {}
$('#handle').value = S.handle;

/* ------------------------------------------------------------------ */
/* Chrome: screens, grain, boil, sound                                 */
/* ------------------------------------------------------------------ */

let zc = 0;
document.addEventListener('click', e => {
  const o = e.target.closest('[data-screen]');
  if (o) {
    const el = $('#s-' + o.dataset.screen);
    el.hidden = false;
    el.style.zIndex = 60 + (++zc);
    if (o.dataset.screen === 'fame') loadFame();
  }
  const c = e.target.closest('[data-close]');
  if (c) c.closest('.screen').hidden = true;
});
['s-recipe', 's-fame'].forEach(id => $('#' + id).addEventListener('click', e => { if (e.target.id === id) e.target.hidden = true; }));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') ['s-recipe', 's-fame'].forEach(id => ($('#' + id).hidden = true));
});

// Film grain: one noise tile, jittered by CSS.
(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 180;
  const x = c.getContext('2d'), im = x.createImageData(180, 180);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = Math.random() * 255;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  $('.grain').style.backgroundImage = `url(${c.toDataURL()})`;
})();
// Boiling ink lines.
const boil = $('#boil-noise');
let boilSeed = 1;
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => boil.setAttribute('seed', String((boilSeed = (boilSeed % 4) + 1))), 130);

const muteBtn = $('#mute');
const syncMute = () => { muteBtn.textContent = sound.muted ? 'Sound off' : 'Sound on'; muteBtn.setAttribute('aria-pressed', String(sound.muted)); };
muteBtn.addEventListener('click', () => { sound.init(); sound.setMuted(!sound.muted); syncMute(); });
syncMute();

function caption(t) {
  const c = $('#caption');
  if (!t) { c.hidden = true; return; }
  c.textContent = t; c.hidden = false;
}

// Classic cartoon iris wipe between scenes.
function iris(mid) {
  const el = $('#iris');
  const t0 = performance.now();
  return new Promise(res => {
    const close = now => {
      const k = Math.min(1, (now - t0) / 380);
      el.style.setProperty('--r', `${(1 - k) * 100}%`);
      if (k < 1) return requestAnimationFrame(close);
      mid && mid();
      setTimeout(() => {
        const t1 = performance.now();
        const open = n2 => {
          const k2 = Math.min(1, (n2 - t1) / 450);
          el.style.setProperty('--r', `${k2 * k2 * 100}%`);
          if (k2 < 1) requestAnimationFrame(open); else res();
        };
        requestAnimationFrame(open);
      }, 120);
    };
    requestAnimationFrame(close);
  });
}

function setStage(stage) {
  S.stage = stage;
  $$('.side [data-panel]').forEach(p => (p.hidden = p.dataset.panel !== stage));
  const order = ['beat', 'cook', 'fold', 'plate', 'judge'];
  const i = order.indexOf(stage);
  $$('#steps li').forEach((li, k) => { li.classList.toggle('now', k === i); li.classList.toggle('done', i > k || stage === 'result'); });
}
function showSet(name) {
  bowl3d.group.visible = name === 'bowl';
  stove.group.visible = name === 'stove';
  plate3d.group.visible = name === 'plate';
}
function goView(name, smooth = true) {
  if (!world) return;
  const v = VIEWS[name];
  const [p, t] = viewPos(v);
  showSet(v.set);
  world.setFocus(SETS[v.set]);
  smooth ? world.moveCamera(p, t, 1.1) : world.snapCamera(p, t);
}

/* ------------------------------------------------------------------ */
/* Title / application                                                 */
/* ------------------------------------------------------------------ */

$('#apply').addEventListener('submit', e => {
  e.preventDefault();
  const h = $('#handle').value.trim().replace(/^@+/, '');
  const err = $('#handle-err');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) {
    err.textContent = 'Use your 𝕏 username: letters, numbers and _ only, up to 15.';
    err.hidden = false; return;
  }
  err.hidden = true;
  S.handle = h;
  try { localStorage.setItem('omu-handle', h); } catch {}
  sound.init();
  $('#s-title').hidden = true;
  startBeat();
});
$('#r-again').addEventListener('click', () => { $('#s-result').hidden = true; startBeat(); });

/* ------------------------------------------------------------------ */
/* 1. Beat                                                             */
/* ------------------------------------------------------------------ */

function startBeat() {
  S.bowl = new Bowl((Math.random() * 1e9) | 0);
  S.pan = new Pan((Math.random() * 1e9) | 0);
  S.roll = 0; S.kick = 0; S.submitted = false; S.result = null; S.tiltHeld = false;
  if (pan3d) pan3d.reset();
  if (plate3d) plate3d.reset();
  $('#egg-n').textContent = '0/3';
  $('#b-crack').disabled = false;
  $('#b-to-cook').disabled = true;
  $('#m-mix').style.width = '0%';
  $('#m-fold').style.width = '0%';
  $('#b-butter').disabled = false; $('#butter-g').textContent = '(10 g)';
  $('#b-pour').disabled = true; $('#b-to-fold').disabled = true; $('#b-to-plate').disabled = true;
  setStage('beat');
  iris(() => goView('beat', false));
  chef.say(`@${S.handle}, is it? Three eggs. Beat them smooth. No shell.`, 'sniff');
  caption('Click the bowl to crack an egg');
}

function crackEgg() {
  const b = S.bowl;
  if (!b || b.eggs >= 3) return;
  const res = b.crack((b.N - 1) / 2 + (Math.random() - 0.5) * 16, (b.N - 1) / 2 + (Math.random() - 0.5) * 16);
  if (bowl3d) bowl3d.crackAnim();
  sound.crack(); setTimeout(() => sound.plop(), 160);
  $('#egg-n').textContent = `${b.eggs}/3`;
  if (res && res.shell) chef.say('Shell! I saw that. Click it to fish it out.', 'angry');
  if (b.eggs === 3) {
    $('#b-crack').disabled = true;
    $('#b-to-cook').disabled = false;
    caption('Drag around the bowl in fast circles');
    if (!b.shells.length) chef.say('Now beat. Quick circles. I want no white streaks.', 'neutral');
  } else caption(`Crack another (${b.eggs}/3)`);
}
$('#b-crack').addEventListener('click', () => { sound.init(); crackEgg(); });
$('#b-to-cook').addEventListener('click', () => {
  startCook();
  if (S.bowl.shells.length) setTimeout(() => chef.say('You left shell in that bowl. I’ll remember.', 'angry'), 900);
});

/* ------------------------------------------------------------------ */
/* 2. Cook                                                             */
/* ------------------------------------------------------------------ */

function startCook() {
  setStage('cook');
  iris(() => goView('cook', false));
  setKnob(0);
  $('#b-pour').disabled = false;
  chef.say('Light the burner. Butter. Pour when it foams. Then scramble like you mean it.', 'neutral');
  caption('Turn the heat on and add butter');
}
function setKnob(k) {
  if (S.pan) S.pan.setKnob(k);
  $$('input[name=knob]').forEach(r => (r.checked = +r.value === k));
  $$('input[name=knob2]').forEach(r => (r.checked = +r.value === k));
  $('#knob-rot').style.transform = `rotate(${[-120, -40, 40, 120][k]}deg)`;
  sound.init();
  if (k) sound.burst(0.25, 1200, 1, 0.15);
}
$$('input[name=knob], input[name=knob2]').forEach(r => r.addEventListener('change', () => setKnob(+r.value)));
$('#b-butter').addEventListener('click', () => {
  if (!S.pan || S.pan.poured) return;
  if (S.pan.addButter()) { sound.plop(); if (S.pan.T > 110) sound.sizzle(1, 1); }
  $('#butter-g').textContent = `(${S.pan.butter} g in)`;
  caption('');
});
$('#b-pour').addEventListener('click', () => {
  if (!S.pan || S.pan.poured) return;
  S.pan.startPour(S.bowl);
  $('#b-pour').disabled = true;
  $('#b-butter').disabled = true;
  caption('Drag in the pan to scramble with the chopsticks');
  setTimeout(() => { if (S.stage === 'cook') caption(''); }, 4000);
  setTimeout(() => { if (S.stage === 'cook') $('#b-to-fold').disabled = false; }, 1600);
});
$('#b-to-fold').addEventListener('click', startFold);

/* ------------------------------------------------------------------ */
/* 3. Fold: tilt the pan and tap the wrist                             */
/* ------------------------------------------------------------------ */

function startFold() {
  setStage('fold');
  goView('fold');
  panSticks.place(null);
  $('#b-to-plate').disabled = false;
  chef.say('Tilt it away. Tap your wrist. Let it jump and roll over itself.', 'neutral');
  caption('Hold TILT, then TAP until it’s a football');
}
const tiltBtn = $('#b-tilt');
const holdOn = e => { e.preventDefault(); S.tiltHeld = true; tiltBtn.classList.add('held'); };
const holdOff = () => { S.tiltHeld = false; tiltBtn.classList.remove('held'); };
tiltBtn.addEventListener('pointerdown', holdOn);
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => tiltBtn.addEventListener(ev, holdOff));
$('#b-tap').addEventListener('click', doTap);
function doTap() {
  if (S.stage !== 'fold' || !S.pan) return;
  const r = S.pan.tap();
  sound.tap();
  S.kick = 1;
  if (!r.ok) {
    if (r.why === 'flat') chef.say('Tilt the pan first! It just jumps and falls back.', 'angry');
    return;
  }
  caption('');
  if (r.tear > 0.25) chef.say('Rrrip. The skin tore. Too wet underneath.', 'shock');
  else if (r.crease > 0.25) chef.say('It’s cracking. That egg is getting firm.', 'angry');
  else if (r.R >= 1) { chef.say('A football. Good. Onto the rice, quick.', 'happy'); caption('Now: “Onto the rice”'); }
  else chef.say(['Again.', 'Good. Again.', 'Keep it rolling.', 'Tap!'][S.pan.rollTaps % 4], 'neutral');
  $('#m-fold').style.width = Math.round(S.pan.rollR * 100) + '%';
}
$('#b-to-plate').addEventListener('click', startPlate);

/* ------------------------------------------------------------------ */
/* 4. Plate                                                            */
/* ------------------------------------------------------------------ */

function startPlate() {
  const pan = S.pan;
  S.finalAgg = pan.aggregate();
  S.leftPanAt = S.t;
  pan.setKnob(0);
  holdOff();
  sound.sizzle(0, 0); sound.hiss(0);
  const R = pan.rollR;
  S.spec = {
    L: 7.0 * (0.86 + 0.14 * R), A: lerp(1.1, 2.2, R),
    dm: S.finalAgg.dm, br: S.finalAgg.br, cu: (pan.stats.atRoll || S.finalAgg).cu,
    tears: pan.tears, creases: pan.creases,
  };
  setStage('plate');
  iris(() => { goView('plate', false); plate3d.aim(S.spec); });
  S.aimP = V(0, 0, 0);
  chef.say(R < 0.4 ? 'That isn’t folded. Tip it on anyway.' : 'Over the middle of the rice. Then turn the pan over.', R < 0.4 ? 'angry' : 'neutral');
  caption('Move the pan over the rice, then click to tip it out');
}

function hitPlate(cx, cy) {
  const ray = world.rayFrom(cx, cy);
  const o = ray.origin.clone().sub(SETS.plate), d = ray.direction;
  for (let t = 0; t < 220; t += 0.25) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.hypot(x, z) < 20 && y <= surface(x, z)) return V(x, y, z);
  }
  return null;
}

// Tip the pan over the rice where the player aimed it.
function placeOmelette(p) {
  if (!plate3d.aiming) return;
  S.plateOffset = Math.hypot(p.x, p.z);
  plate3d.setAim(p.x, p.z);
  plate3d.tip();
  sound.burst(0.4, 900, 0.8, 0.18);
  S.stage = 'placed';
  S.landed = false;
  caption('');
}

/* ------------------------------------------------------------------ */
/* 5. Judge: the head chef's cut is the reveal                          */
/* ------------------------------------------------------------------ */

function startJudge() {
  setStage('judge');
  goView('judge');
  const rest = S.t - S.leftPanAt;
  S.dmFinal = S.finalAgg.dm + Math.min(0.05, rest * 0.003);
  const om = plate3d.om;
  plate3d.place({ x: om.x, z: om.z, ...S.spec, dm: S.dmFinal });
  plate3d.om.drop = 0;
  S.judgeT = 0;
  S.reacted = false;
  chef.say('Stand back. Let’s see what you made.', 'sniff');
  S.result = scoreRun({
    mix: S.bowl.mixedness(), foam: S.bowl.foamLevel(), shells: S.pan.shellsInEgg,
    pan: S.pan, plateOffset: S.plateOffset, dmFinal: S.dmFinal, rolledR: S.pan.rollR,
  });
}

function judgeTick(dt) {
  S.judgeT += dt;
  const t = S.judgeT;
  if (t > 1.0 && !plate3d.om.open) { plate3d.startCut(); setTimeout(() => sound.knife(), 650); }
  if (t > 3.4 && !S.reacted) {
    S.reacted = true;
    const d = S.dmFinal;
    if (d >= 0.45 && d <= 0.6) chef.say('Look at that. LOOK at it! That’s hanjuku.', 'happy');
    else if (d < 0.3) chef.say('It’s SOUP! You flooded my plate!', 'shock');
    else if (d < 0.45) chef.say('Runny. A bit too runny. Close…', 'sniff');
    else if (d < 0.7) chef.say('Hmph. It opened, but the middle has set.', 'sniff');
    else chef.say('It’s SOLID. It just split in half! Terrible!', 'angry');
  }
  if (t > 6.2 && S.stage === 'judge') showResult(S.result);
}

function verdictQuote(score) {
  if (score > 90) return '“You start Monday. Bring your own chopsticks.”';
  if (score >= 85) return '“Close. Very close. Come back next week.”';
  if (score >= 70) return '“You can cook. That wasn’t this omelette, though.”';
  if (score >= 50) return '“We’ll keep your application on file.”';
  return '“Have you considered washing dishes?”';
}

function showResult(res) {
  setStage('result');
  const hired = res.total > 90;
  const st = $('#r-stamp');
  st.textContent = hired ? 'HIRED!' : 'NOT HIRED';
  st.className = 'stamp boil ' + (hired ? 'hired' : 'fired');
  const sc = $('#s-result');
  sc.style.setProperty('--rc1', hired ? '#ffdc3a' : '#d6402f');
  sc.style.setProperty('--rc2', hired ? '#ffc61a' : '#b8322a');
  $('#r-quote').textContent = verdictQuote(res.total);
  const ul = $('#r-lines');
  ul.innerHTML = '';
  for (const l of res.lines) {
    const li = document.createElement('li');
    if (l.key === 'inside') li.className = 'key';
    const b = document.createElement('b'); b.textContent = l.label;
    const p = document.createElement('span'); p.className = 'p'; p.textContent = `${Math.round(l.pts)}/${l.max}`;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = l.note;
    li.append(b, p, n); ul.appendChild(li);
  }
  const su = document.getElementById('share-url');
  const url = (su && su.dataset.url) || location.origin + location.pathname;
  const text = hired
    ? `I scored ${res.total}/100 at the Hanjuku-tei omurice trial and got HIRED 🍳 Can you cook the perfect split omelette?`
    : `I scored ${res.total}/100 at the Hanjuku-tei omurice trial. Not hired 🥲 Can you cook the perfect split omelette?`;
  $('#r-share').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  const el = $('#r-score');
  const t0 = performance.now();
  const tick = now => {
    const k = Math.min(1, (now - t0) / 1100);
    el.textContent = Math.round(res.total * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  sc.hidden = false;
  hired ? sound.tada() : sound.fail();
  $('#r-rank').textContent = 'Posting to the Wall of Fame…';
  if (!S.submitted) {
    S.submitted = true;
    const breakdown = Object.fromEntries(res.lines.map(l => [l.key, Math.round(l.pts)]));
    submitScore({ name: S.handle, score: res.total, breakdown }).then(r => {
      $('#r-rank').textContent = r.online && r.rank ? `You're #${r.rank} of ${r.of} on the Wall of Fame.` : r.online ? 'Posted to the Wall of Fame.' : 'Saved on this device. The Wall of Fame didn’t accept it from here.';
    });
  }
}

/* ---------------- Wall of Fame ---------------- */

async function loadFame() {
  const ol = $('#fame-list');
  ol.innerHTML = '<li class="muted">Loading…</li>';
  const { online, entries } = await fetchBoard();
  ol.innerHTML = '';
  if (!entries.length) ol.innerHTML = '<li class="muted">Nobody yet. Be the first cook on the wall.</li>';
  entries.slice(0, 100).forEach((e, i) => {
    const li = document.createElement('li');
    if (S.handle && e.name.toLowerCase() === S.handle.toLowerCase()) li.className = 'me';
    const r = document.createElement('span'); r.className = 'rank'; r.textContent = i + 1;
    const w = document.createElement('span'); w.className = 'who'; w.textContent = '@' + e.name;
    const p = document.createElement('span'); p.className = 'pts'; p.textContent = e.score;
    const t = document.createElement('span'); t.className = 'tag ' + (e.score > 90 ? 'h' : 'n'); t.textContent = e.score > 90 ? 'HIRED' : 'NOPE';
    li.append(r, w, p, t); ol.appendChild(li);
  });
  $('#fame-note').textContent = online ? 'Best score per cook. Over 90 means hired.' : 'Offline: scores from this device only.';
}

/* ------------------------------------------------------------------ */
/* Pointer on the 3D view                                              */
/* ------------------------------------------------------------------ */

const cv = $('#gl');
function bowlHit(e) {
  const p = world.hitLocalPlane(e.clientX, e.clientY, bowl3d.group, bowl3d.liquidY());
  return p ? { p, cell: bowl3d.toCell(p.x, p.z) } : null;
}
function panHit(e) {
  const p = world.hitLocalPlane(e.clientX, e.clientY, pan3d.group, 0.4);
  return p ? { p, cell: pan3d.localToCell(p.x, p.z, S.pan) } : null;
}
cv.addEventListener('pointerdown', e => {
  if (!world) return;
  sound.init();
  cv.setPointerCapture(e.pointerId);
  const P = S.ptr;
  P.down = true; P.last = null; P.lastT = performance.now(); P.vx = P.vy = 0;
  if (S.stage === 'beat' && S.bowl) {
    const b = S.bowl;
    if (b.eggs < 3) { crackEgg(); P.down = false; return; }
    const h = bowlHit(e);
    if (h && b.removeShellAt(h.cell[0], h.cell[1])) {
      sound.ding();
      chef.say(b.shells.length ? 'There’s more in there.' : 'Good. Now beat.', b.shells.length ? 'sniff' : 'neutral');
      P.down = false;
    }
  } else if (S.stage === 'plate') {
    const p = hitPlate(e.clientX, e.clientY);
    if (p) placeOmelette(p);
    P.down = false;
  }
  onMove(e);
});
cv.addEventListener('pointermove', onMove);
const up = () => { S.ptr.down = false; S.ptr.last = null; };
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('pointerleave', () => { up(); bowlSticks && bowlSticks.place(null); panSticks && panSticks.place(null); });

function onMove(e) {
  if (!world) return;
  const P = S.ptr;
  const now = performance.now();
  const dt = Math.max(1, now - P.lastT) / 1000;
  if (S.stage === 'beat' && S.bowl && S.bowl.eggs > 0) {
    const h = bowlHit(e);
    bowlSticks.place(h && h.p, P.down, S.t);
    if (h && P.down && P.last) {
      const [lx, ly] = P.last;
      P.vx = lerp(P.vx, (h.cell[0] - lx) / dt, 0.5); P.vy = lerp(P.vy, (h.cell[1] - ly) / dt, 0.5);
      const steps = Math.max(1, Math.ceil(Math.hypot(h.cell[0] - lx, h.cell[1] - ly) / 2));
      for (let i = 1; i <= steps; i++) S.bowl.whisk(lerp(lx, h.cell[0], i / steps), lerp(ly, h.cell[1], i / steps), P.vx, P.vy, dt / steps);
      if (Math.random() < 0.25) sound.burst(0.04, 1500 + Math.random() * 1500, 3, 0.08);
    }
    P.last = h ? h.cell : null;
  } else if (S.stage === 'cook' && S.pan) {
    const h = panHit(e);
    panSticks.place(S.pan.poured && h ? h.p : null, P.down, S.t);
    if (h && P.down && P.last && S.pan.poured) {
      const [lx, ly] = P.last;
      P.vx = lerp(P.vx, (h.cell[0] - lx) / dt, 0.5); P.vy = lerp(P.vy, (h.cell[1] - ly) / dt, 0.5);
      const steps = Math.max(1, Math.ceil(Math.hypot(h.cell[0] - lx, h.cell[1] - ly) / 1.5));
      let w = 0;
      for (let i = 1; i <= steps; i++) w += S.pan.stir(lerp(lx, h.cell[0], i / steps), lerp(ly, h.cell[1], i / steps), P.vx, P.vy, dt / steps);
      if (w > 0 && Math.random() < 0.3) sound.scrape();
    }
    P.last = h ? h.cell : null;
  } else if (S.stage === 'plate') {
    const p = hitPlate(e.clientX, e.clientY);
    if (p) { S.aimP = p; plate3d.setAim(p.x, p.z); }
  }
  P.lastT = now;
}

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input')) return;
  if (S.stage === 'fold') {
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { $('#b-tap').classList.add('held'); doTap(); } }
    if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); S.tiltHeld = true; tiltBtn.classList.add('held'); }
  }
  if ((S.stage === 'cook' || S.stage === 'fold') && /^Digit[0-3]$/.test(e.code)) setKnob(+e.code.slice(5));
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space') $('#b-tap').classList.remove('held');
  if (e.code === 'KeyW' || e.code === 'ArrowUp') holdOff();
});

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */

const zoneArc = (a, b) => {
  const ang = T => Math.PI - (T / 300) * Math.PI;
  const p = T => [70 + Math.cos(ang(T)) * 54, 80 - Math.sin(ang(T)) * 54];
  const [x0, y0] = p(a), [x1, y1] = p(b);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A54 54 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};
$('#zone-good').setAttribute('d', zoneArc(150, 190));
$('#zone-hot').setAttribute('d', zoneArc(225, 300));

let lastSay = '';
function chefWatch(pan, agg) {
  let line = null, mood = 'neutral';
  if (!pan.poured) {
    const st = pan.butterState();
    if (pan.smoke > 0.3) { line = 'Smoke! You’re burning my kitchen down!'; mood = 'angry'; }
    else if (st === 'burnt') { line = 'Black butter. That’s burnt.'; mood = 'angry'; }
    else if (st === 'brown') { line = 'Brown butter. Nutty. Wrong.'; mood = 'sniff'; }
    else if (st === 'foaming') line = 'Foaming. Hear that crackle?';
    else if (st === 'clear') line = 'Foam’s dying down. Don’t dawdle.';
    else if (st === 'melting') line = pan.T < 45 ? 'Butter in a cold pan. Turn on the heat.' : 'Melting…';
    else if (!pan.knob) line = 'The burner is off, cook.';
    else if (pan.T < 120) line = 'Warming up.';
    else if (!pan.butter) line = 'Hot pan, no butter?';
  } else if (pan.pouring) line = 'Pour!';
  else if (S.stage === 'cook') {
    if (pan.T < 105) { line = 'No sizzle. The egg is just sitting there.'; mood = 'sniff'; }
    else if (agg.dm < 0.14) line = agg.cu > 0.15 ? 'Keep scrambling! Little curds!' : 'Stir! Stir now!';
    else if (agg.dm < 0.32) line = agg.cu > 0.2 ? 'Good curds. Top still wet.' : 'You’re not stirring. Stir!';
    else if (agg.dm < 0.45) line = 'Wet scrambled egg. Stop stirring, let the skin set. Then fold.';
    else if (agg.dm < 0.58) { line = 'It’s setting. Fold it NOW.'; mood = 'shock'; }
    else { line = 'Too long! It’s cooking through!'; mood = 'angry'; }
  } else if (S.stage === 'fold' && agg.dm > 0.62 && pan.rollR < 1) { line = 'Hurry, it’s cooking through!'; mood = 'angry'; }
  if (line && line !== lastSay) { lastSay = line; chef.say(line, mood); }
}

let last = performance.now(), acc = 0, firstFrame = true;
const DT = 1 / 60;
function frame(now) {
  const el = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += el;
  let n = 0;
  while (acc >= DT && n < 4) { update(DT); acc -= DT; n++; }
  if (n === 4) acc = 0;
  if (world) {
    world.update(el);
    world.render();
    if (firstFrame) { firstFrame = false; $('#loading').hidden = true; }
  }
  requestAnimationFrame(frame);
}

function update(dt) {
  S.t += dt;
  if (!world) return;
  const st = S.stage;
  if (st === 'beat' && S.bowl) {
    S.bowl.step(dt);
    bowl3d.update(S.bowl, S.t, dt);
    if (S.bowl.eggs === 3) $('#m-mix').style.width = Math.round(S.bowl.mixedness() * 100) + '%';
  }
  const pan = S.pan;
  if ((st === 'cook' || st === 'fold') && pan) {
    const target = st === 'fold' && S.tiltHeld ? 0.75 : 0;
    pan.tiltY += (target - pan.tiltY) * Math.min(1, dt * 7);
    pan.step(dt);
    S.roll += (pan.rollR - S.roll) * Math.min(1, dt * 8);
    S.kick = Math.max(0, S.kick - dt * 5);
    const kick = Math.sin(S.kick * Math.PI) * S.kick;
    stove.update(S.t, pan.knob);
    pan3d.update(pan, S.t, dt, { roll: S.roll, kick });
    const agg = pan._lastAgg || { mass: 0, dm: 0, cover: 0, cu: 0 };
    const wet = pan.poured ? agg.cover * (1 - sstep(0.4, 1, agg.dm)) * 1.1 + 0.15 : pan.butter && pan.butterMelt > 0.3 ? pan.butterWater * 0.9 + 0.15 : 0;
    const heat = sstep(95, 190, pan.T);
    sound.sizzle(wet * heat, pan.butterState() === 'foaming' ? 0.4 : heat * wet * 0.4);
    sound.hiss(pan.knob ? 0.3 + pan.knob * 0.25 : 0);
    const T = Math.round(pan.T);
    const tEl = $('#temp');
    if (tEl.textContent !== String(T)) tEl.textContent = T;
    $('#needle').style.transform = `rotate(${-90 + clamp(pan.T / 300, 0, 1) * 180}deg)`;
    const ct = pan.cookTime().toFixed(1) + 's';
    $('#cook-t').textContent = ct; $('#cook-t2').textContent = ct;
    chefWatch(pan, agg);
  }
  if (plate3d && plate3d.om && (st === 'placed' || st === 'judge' || st === 'result' || st === 'plate')) plate3d.update(dt);
  if (st === 'placed') {
    if (!S.landed && plate3d.tipT > 1.3) { S.landed = true; sound.plop(); }
    if (plate3d.tipDone) startJudge();
  }
  if (st === 'judge') judgeTick(dt);
}

setStage('beat');
requestAnimationFrame(frame);
fetchBoard();

// For poking at the game from the console.
window.__omu = { hitPlate, tick(sec) { for (let i = 0; i < sec * 60; i++) update(DT); }, S, get world() { return world; }, plate3d, pan3d, bowl3d, startPlate, startJudge, startFold, placeOmelette, showResult, setStage, goView, setKnob };
