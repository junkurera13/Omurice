// Chef Okada: a 1930s rubber-hose head chef, drawn in SVG. He talks in a
// speech bubble and pulls faces: neutral, happy, angry, shock, sniff.
export const CHEF_SVG = `
<svg class="chef" viewBox="0 0 220 240" aria-hidden="true">
  <g class="chef-body">
    <!-- jacket -->
    <path d="M38 238 C40 196 70 178 110 178 C150 178 180 196 182 238 Z" fill="#fbf6ea" stroke="#17110c" stroke-width="5"/>
    <path d="M110 180 L110 238" stroke="#17110c" stroke-width="3"/>
    <circle cx="96" cy="204" r="4" fill="#17110c"/><circle cx="96" cy="224" r="4" fill="#17110c"/>
    <circle cx="124" cy="204" r="4" fill="#17110c"/><circle cx="124" cy="224" r="4" fill="#17110c"/>
    <!-- neckerchief -->
    <path d="M86 178 L110 196 L134 178 L128 172 L110 182 L92 172 Z" fill="#b8322a" stroke="#17110c" stroke-width="4" stroke-linejoin="round"/>
  </g>
  <g class="chef-head">
    <!-- toque -->
    <path d="M62 86 C40 80 38 46 62 42 C64 18 96 10 108 28 C120 8 156 16 152 42 C178 44 178 82 156 86 Z" fill="#fbf6ea" stroke="#17110c" stroke-width="5" stroke-linejoin="round"/>
    <path d="M64 84 L156 84 L152 102 L68 102 Z" fill="#fbf6ea" stroke="#17110c" stroke-width="5" stroke-linejoin="round"/>
    <path d="M86 50 C88 62 86 72 84 82 M110 40 C112 56 112 70 110 82 M134 50 C134 62 136 72 138 82" stroke="#17110c" stroke-width="3" fill="none" stroke-linecap="round"/>
    <!-- ears -->
    <ellipse cx="56" cy="134" rx="11" ry="14" fill="#f2d3b0" stroke="#17110c" stroke-width="5"/>
    <ellipse cx="164" cy="134" rx="11" ry="14" fill="#f2d3b0" stroke="#17110c" stroke-width="5"/>
    <!-- face -->
    <path d="M60 104 C58 150 76 176 110 176 C144 176 162 150 160 104 Z" fill="#f2d3b0" stroke="#17110c" stroke-width="5" stroke-linejoin="round"/>
    <!-- brows -->
    <path class="brow brow-l" d="M78 112 C86 106 96 106 102 112" stroke="#17110c" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path class="brow brow-r" d="M118 112 C124 106 134 106 142 112" stroke="#17110c" stroke-width="6" fill="none" stroke-linecap="round"/>
    <!-- pie-cut eyes -->
    <g class="eyes">
      <ellipse cx="92" cy="128" rx="9" ry="14" fill="#fff" stroke="#17110c" stroke-width="4"/>
      <ellipse cx="128" cy="128" rx="9" ry="14" fill="#fff" stroke="#17110c" stroke-width="4"/>
      <g class="pupils">
        <path d="M93 124 m-5 0 a5 9 0 1 0 10 0 a5 9 0 1 0 -10 0 Z" fill="#17110c"/>
        <path d="M129 124 m-5 0 a5 9 0 1 0 10 0 a5 9 0 1 0 -10 0 Z" fill="#17110c"/>
        <path d="M95 118 l3 -2 l-1 5 Z M131 118 l3 -2 l-1 5 Z" fill="#fff"/>
      </g>
      <path class="lids" d="M82 124 C86 112 98 112 102 124 Z M118 124 C122 112 134 112 138 124 Z" fill="#f2d3b0" stroke="#17110c" stroke-width="3"/>
    </g>
    <!-- nose -->
    <ellipse cx="110" cy="146" rx="12" ry="9" fill="#17110c"/>
    <ellipse cx="106" cy="143" rx="4" ry="2.5" fill="#fff" opacity=".8"/>
    <!-- mouths -->
    <path class="mouth m-neutral" d="M98 168 C104 171 116 171 122 168" stroke="#17110c" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path class="mouth m-happy" d="M90 162 C96 178 124 178 130 162 Z" fill="#7a1d18" stroke="#17110c" stroke-width="4" stroke-linejoin="round"/>
    <path class="mouth m-angry" d="M94 172 C100 164 120 164 126 172" stroke="#17110c" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse class="mouth m-shock" cx="110" cy="168" rx="7" ry="9" fill="#7a1d18" stroke="#17110c" stroke-width="4"/>
    <path class="mouth m-sniff" d="M100 170 C106 166 112 172 120 167" stroke="#17110c" stroke-width="5" fill="none" stroke-linecap="round"/>
    <!-- handlebar moustache -->
    <path d="M110 154 C100 150 88 152 80 160 C76 164 70 162 70 156 C72 166 86 168 96 162 C102 159 107 158 110 160 C113 158 118 159 124 162 C134 168 148 166 150 156 C150 162 144 164 140 160 C132 152 120 150 110 154 Z" fill="#17110c"/>
    <!-- sweat / steam marks -->
    <g class="fx-angry"><path d="M164 92 l10 -10 M170 100 l14 -4 M162 84 l2 -14" stroke="#b8322a" stroke-width="4" stroke-linecap="round"/></g>
    <g class="fx-happy"><path d="M40 70 l6 6 m0 -6 l-6 6 M176 60 l6 6 m0 -6 l-6 6" stroke="#e2a823" stroke-width="4" stroke-linecap="round"/></g>
  </g>
</svg>`;

export class Chef {
  constructor(root, bubble) {
    this.root = root;
    this.bubble = bubble;
    root.innerHTML = CHEF_SVG;
    this.svg = root.querySelector('svg');
    this.mood('neutral');
    this.timer = null;
    this.lastText = '';
    // Blink now and then.
    setInterval(() => {
      this.svg.classList.add('blink');
      setTimeout(() => this.svg.classList.remove('blink'), 130);
    }, 3800);
  }
  mood(m) {
    this.svg.dataset.mood = m;
  }
  say(text, mood) {
    if (mood) this.mood(mood);
    if (text === this.lastText) return;
    this.lastText = text;
    const b = this.bubble;
    b.textContent = text;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
    this.svg.classList.remove('talk');
    void this.svg.offsetWidth;
    this.svg.classList.add('talk');
  }
  look(dx, dy) {
    const p = this.svg.querySelector('.pupils');
    if (p) p.setAttribute('transform', `translate(${dx * 3} ${dy * 3})`);
  }
}
