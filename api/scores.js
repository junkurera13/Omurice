// Hall of Fame storage on Vercel Blob. Each score is its own tiny blob and
// everything the board needs is in the pathname, so reading the board is a
// single list() call and concurrent writes never clobber each other.
//   s/<1000-score>_<time36>_<base64url name>.json
import { put, list } from '@vercel/blob';

const NAME_RE = /^[\p{L}\p{N} _.@\-']{2,18}$/u;
const MAX = { prep: 5, heat: 10, curds: 15, color: 15, roll: 15, inside: 25, plate: 5, slit: 10 };

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url').toString('utf8');

async function readAll() {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const r = await list({ prefix: 's/', limit: 1000, cursor });
    for (const b of r.blobs) {
      const m = /^s\/(\d{4})_([0-9a-z]+)_([A-Za-z0-9_-]+)\.json$/.exec(b.pathname);
      if (!m) continue;
      try {
        out.push({ score: 1000 - Number(m[1]), ts: parseInt(m[2], 36), name: unb64(m[3]) });
      } catch {}
    }
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return out;
}

function board(all) {
  const best = new Map();
  for (const e of all) {
    const k = e.name.toLowerCase();
    const cur = best.get(k);
    if (!cur || e.score > cur.score || (e.score === cur.score && e.ts < cur.ts)) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.ts - b.ts);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const entries = board(await readAll()).slice(0, 100);
      res.setHeader('cache-control', 'public, s-maxage=10, stale-while-revalidate=30');
      return res.status(200).json({ entries });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      const score = Number(body.score);
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'bad name' });
      if (!Number.isInteger(score) || score < 0 || score > 100) return res.status(400).json({ error: 'bad score' });
      // The breakdown has to add up and stay within each station's maximum.
      const bd = body.breakdown || {};
      let sum = 0;
      for (const [k, max] of Object.entries(MAX)) {
        const v = Number(bd[k]);
        if (!Number.isFinite(v) || v < 0 || v > max) return res.status(400).json({ error: 'bad breakdown' });
        sum += v;
      }
      if (Math.abs(sum - score) > 4) return res.status(400).json({ error: 'bad breakdown' });
      const ts = Date.now();
      const path = `s/${String(1000 - score).padStart(4, '0')}_${ts.toString(36)}_${b64(name)}.json`;
      await put(path, JSON.stringify({ name, score, ts, breakdown: bd }), {
        access: 'public', addRandomSuffix: false, contentType: 'application/json',
      });
      const entries = board(await readAll());
      const rank = entries.findIndex(e => e.name.toLowerCase() === name.toLowerCase()) + 1;
      return res.status(200).json({ ok: true, rank, of: entries.length });
    }
    res.setHeader('allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
