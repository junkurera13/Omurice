// Leaderboard client. Three places a score can live, tried in order:
//  1. the Claude Artifact's shared database (when the game runs as an Artifact)
//  2. the /api/scores endpoint (when it's deployed on Vercel)
//  3. this browser only (offline / local file)
const LOCAL = 'omu-local-scores';

function localGet() {
  try { return JSON.parse(localStorage.getItem(LOCAL) || '[]'); } catch { return []; }
}
function localPut(list) {
  try { localStorage.setItem(LOCAL, JSON.stringify(list.slice(0, 100))); } catch {}
}
function bestPerName(list) {
  const m = new Map();
  for (const e of list) {
    const k = String(e.name).toLowerCase();
    const cur = m.get(k);
    if (!cur || e.score > cur.score || (e.score === cur.score && e.ts < cur.ts)) m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.score - a.score || a.ts - b.ts);
}

// --- Artifact database ---
let dbP = null;
function artifactDb() {
  if (dbP) return dbP;
  dbP = (async () => {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') return null;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db) return null;
      return { db, user };
    } catch { return null; }
  })();
  return dbP;
}

async function dbBoard(A) {
  const snap = await A.db.collection('scores').orderBy('score', 'desc').limit(200).get();
  const list = snap.docs.map(d => d.data()).filter(d => d && typeof d.name === 'string' && Number.isFinite(d.score));
  return bestPerName(list.map(d => ({ name: d.name.slice(0, 18), score: Math.round(d.score), ts: d.ts || 0 })));
}

async function dbSubmit(A, entry) {
  const id = A.user ? await A.user.id() : null;
  if (!id) return { ok: false };
  const ref = A.db.collection('scores').doc(id);
  const cur = await ref.get();
  const prev = cur.exists ? cur.data() : null;
  // Keep each person's best run.
  if (!prev || entry.score > prev.score) {
    await ref.set({ name: entry.name, score: entry.score, ts: Date.now(), breakdown: entry.breakdown });
  }
  const board = await dbBoard(A);
  const rank = board.findIndex(e => e.name.toLowerCase() === entry.name.toLowerCase()) + 1;
  return { ok: true, rank, of: board.length };
}

// --- Public API ---
export async function fetchBoard() {
  const A = await artifactDb();
  if (A) {
    try { return { online: true, entries: await dbBoard(A) }; } catch {}
  }
  if (!A && location.protocol.startsWith('http')) {
    try {
      const r = await fetch('api/scores', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      return { online: true, entries: j.entries || [] };
    } catch {}
  }
  return { online: false, entries: bestPerName(localGet()) };
}

export async function submitScore(entry) {
  const local = localGet();
  local.push({ ...entry, ts: Date.now() });
  local.sort((a, b) => b.score - a.score);
  localPut(local);
  const A = await artifactDb();
  if (A) {
    try {
      const r = await dbSubmit(A, entry);
      if (r.ok) return { online: true, rank: r.rank, of: r.of };
    } catch {}
    return { online: false };
  }
  try {
    const r = await fetch('api/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!r.ok) throw new Error(r.status);
    return { online: true, ...(await r.json()) };
  } catch {
    return { online: false };
  }
}
