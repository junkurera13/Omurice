// The share card: a 1200x630 scorecard that 𝕏 shows under a shared result.
//   /api/og?n=<handle>&s=<score>&b=<prep,heat,scramble,control,fold,plate,inside>
import { ImageResponse } from '@vercel/og';
import { CHEF_SVG } from '../js/chef.js';
import { verdictQuote } from '../js/verdict.js';

const INK = '#17110c', PAPER = '#f2e5c6', CREAM = '#fbf6ea', RED = '#b8322a', MUSTARD = '#ffcf1f';
const STATIONS = [
  ['Prep', 10], ['Heat', 15], ['Scramble', 15], ['Control', 10], ['Fold', 15], ['Plate', 5], ['Inside', 30],
];

// Tiny element builder, so the card can be written without JSX.
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children } });

// Sunburst behind the card, like the result screen's spinning rays.
function rays(c1, c2) {
  const n = 26, R = 1400, cx = 600, cy = 315;
  let wedges = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2;
    wedges += `<path d="M${cx} ${cy} L${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} L${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)} Z" fill="${c2}"/>`;
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="${c1}"/>${wedges}</svg>`)}`;
}

// Chef Okada with one face: the page picks a face with CSS, an image can't.
function chef(mood) {
  let svg = CHEF_SVG.trim().replace('<svg class="chef"', '<svg xmlns="http://www.w3.org/2000/svg"');
  svg = svg.replace(/<path class="lids"[^>]*\/>/, '');
  svg = svg.replace(/<(path|ellipse) class="mouth m-(\w+)"[^>]*\/>/g, (m, _t, k) => (k === mood ? m : ''));
  svg = svg.replace(/<g class="fx-(\w+)">.*?<\/g>/g, (m, k) => (k === mood ? m : ''));
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function font(family, text) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error(`no font for ${family}`);
  return (await fetch(url)).arrayBuffer();
}

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const name = /^[A-Za-z0-9_]{1,15}$/.test(q.get('n') || '') ? q.get('n') : null;
  const score = Math.max(0, Math.min(100, Math.round(Number(q.get('s')) || 0)));
  const parts = (q.get('b') || '').split(',').map(Number);
  const breakdown = parts.length === STATIONS.length && parts.every((v, i) => v >= 0 && v <= STATIONS[i][1]) ? parts : null;
  const hired = score > 90;
  const quote = verdictQuote(score);

  const who = name ? `@${name}` : 'A new cook';
  const big = `${score}/100 HIRED! NOT OMURICE${who}`;
  const deco = 'HANJUKU-TEI TRIAL SCORECARD Can you beat it? omu-rice.vercel.app';
  const type = quote + STATIONS.map(([l]) => l).join('') + '0123456789/ ';
  const [ultra, limelight, elite] = await Promise.all([
    font('Ultra', big), font('Limelight', deco), font('Special+Elite', type),
  ]);

  const stamp = h('div', {
    position: 'absolute', top: -34, right: -26, transform: 'rotate(7deg)',
    padding: '6px 20px', border: `7px solid ${hired ? RED : INK}`, borderRadius: 14,
    background: hired ? MUSTARD : CREAM, boxShadow: `6px 6px 0 ${INK}`,
    fontSize: 42, fontFamily: 'Ultra', color: hired ? RED : INK,
  }, hired ? 'HIRED!' : 'NOT HIRED');

  const pills = breakdown && h('div', { gap: 7, marginTop: 22 },
    ...STATIONS.map(([label, max], i) => h('div', {
      flexDirection: 'column', alignItems: 'center', padding: '5px 8px',
      border: `3px solid ${INK}`, borderRadius: 10, background: breakdown[i] / max >= 0.8 ? '#fff3cf' : CREAM,
    },
      h('div', { fontSize: 14, fontFamily: 'Special Elite', color: RED }, label),
      h('div', { fontSize: 19, fontFamily: 'Special Elite', color: INK }, `${breakdown[i]}/${max}`),
    )));

  const card = h('div', {
    position: 'relative', width: 1040, height: 470, padding: '40px 50px', alignItems: 'center', gap: 36,
    background: PAPER, border: `8px solid ${INK}`, borderRadius: '38px 48px 34px 44px', boxShadow: `14px 14px 0 ${INK}`,
  },
    { type: 'img', props: { src: chef(hired ? 'happy' : 'sniff'), width: 270, height: 295 } },
    h('div', { flexDirection: 'column', flex: 1 },
      h('div', { fontSize: 22, fontFamily: 'Limelight', letterSpacing: 4, color: RED }, 'HANJUKU-TEI TRIAL SCORECARD'),
      // Ultra's widest letters run about 0.95em, so long handles step down to fit.
      h('div', { fontSize: Math.min(46, Math.floor(600 / (who.length * 0.95))), fontFamily: 'Ultra', color: INK, marginTop: 6 }, who),
      h('div', { alignItems: 'flex-end', marginTop: 4 },
        h('div', { fontSize: 132, fontFamily: 'Ultra', lineHeight: 1, color: MUSTARD, textShadow: `5px 5px 0 ${RED}, 10px 10px 0 ${INK}` }, String(score)),
        h('div', { fontSize: 44, fontFamily: 'Ultra', color: INK, marginLeft: 14, marginBottom: 14 }, '/100'),
      ),
      h('div', { fontSize: 24, fontFamily: 'Special Elite', color: INK, marginTop: 14 }, quote),
      pills || h('div', {}),
    ),
    stamp,
  );

  return new ImageResponse(
    h('div', { width: 1200, height: 630, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' },
      { type: 'img', props: { src: rays(hired ? '#ffdc3a' : '#d6402f', hired ? '#ffc61a' : '#b8322a'), width: 1200, height: 630, style: { position: 'absolute', top: 0, left: 0 } } },
      card,
      h('div', { position: 'absolute', bottom: 18, fontSize: 24, fontFamily: 'Limelight', color: INK, letterSpacing: 2 }, 'Can you beat it? omu-rice.vercel.app'),
    ),
    {
      width: 1200, height: 630,
      fonts: [
        { name: 'Ultra', data: ultra, style: 'normal' },
        { name: 'Limelight', data: limelight, style: 'normal' },
        { name: 'Special Elite', data: elite, style: 'normal' },
      ],
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    },
  );
}
