// A shared result: /s/<score>/<handle>?b=<breakdown>. 𝕏 reads the card tags
// and shows /api/og as a large image; people who click through get the game.
const esc = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export function GET(req) {
  const u = new URL(req.url);
  const q = u.searchParams;
  const name = /^[A-Za-z0-9_]{1,15}$/.test(q.get('n') || '') ? q.get('n') : '';
  const score = Math.max(0, Math.min(100, Math.round(Number(q.get('s')) || 0)));
  const b = /^\d{1,2}(,\d{1,2}){6}$/.test(q.get('b') || '') ? q.get('b') : '';
  const hired = score > 90;

  const img = new URL('/api/og', u.origin);
  img.searchParams.set('n', name);
  img.searchParams.set('s', score);
  if (b) img.searchParams.set('b', b);

  const who = name ? `@${name}` : 'A new cook';
  const title = `${who} scored ${score}/100 at Hanjuku-tei. ${hired ? 'HIRED!' : 'Not hired.'}`;
  const desc = 'Cook Chef Okada one omurice. Score over 90 and the job’s yours.';
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img.href)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img.href)}">
<meta http-equiv="refresh" content="0; url=/">
</head><body><a href="/">Play OMURICE</a></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
