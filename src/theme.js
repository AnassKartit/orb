// Theme synthesis: one accent color + a mode in, a complete, validated palette out.
// Palettes are built in OKLCH, then checked for the properties the data-viz literature asks for:
// colour-vision-deficiency separation of neighbouring series, normal-vision separation, and contrast on the background.
// Everything is deterministic, so the same inputs always give the same theme.

const clamp01 = x => Math.min(1, Math.max(0, x));
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255);
}
const rgbToHex = rgb => '#' + rgb.map(c => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');

function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function oklabToLin([L, a, b]) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const hexToOklab = hex => linToOklab(hexToRgb(hex).map(toLin));
function oklch(L, C, h) {
  // reduce chroma until the colour fits in sRGB
  for (let c = C; c >= 0; c -= 0.004) {
    const lin = oklabToLin([L, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)]);
    if (lin.every(v => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(v => toGam(clamp01(v))));
  }
  return rgbToHex([L, L, L].map(toGam));
}
function hueOf(hex) { const [, a, b] = hexToOklab(hex); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; }

// Machado et al. 2009 colour-vision-deficiency simulation matrices (severity 1.0), applied in linear RGB
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (hex, m) => { const lin = hexToRgb(hex).map(toLin); return linToOklab(m.map(r => r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2])); };
const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = hex => { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((v, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [v, ...p]));
}

// Pick the ordering of five hues whose neighbours are easiest to tell apart, also for colour-blind readers.
function categorical(h, mode, bg) {
  const baseL = mode === 'dark' ? 0.66 : 0.55;
  let best = null;
  // search ordering, hue spacing and lightness spread; keep the candidate with the best worst-case separation
  for (const spacing of [72, 64, 80, 58, 86]) for (const amp of [0.03, 0.05, 0.07]) {
    const slots = [0, 1, 2, 3, 4].map(k => ({ hue: (h + k * spacing) % 360, L: baseL + (k % 2 ? amp : -amp), C: k % 2 ? 0.13 : 0.16 }));
    for (const perm of permutations([1, 2, 3, 4])) {
      const order = [0, ...perm];
      const cols = order.map(i => oklch(slots[i].L, slots[i].C, slots[i].hue));
      let minN = Infinity, minC = Infinity;
      for (let i = 0; i < cols.length - 1; i++) {
        minN = Math.min(minN, dE(hexToOklab(cols[i]), hexToOklab(cols[i + 1])));
        for (const m of Object.values(CVD)) minC = Math.min(minC, dE(simulate(cols[i], m), simulate(cols[i + 1], m)));
      }
      const contrastMin = Math.min(...cols.map(c => contrast(c, bg)));
      const score = Math.min(minC / 8, minN / 15, contrastMin / 3);
      if (!best || score > best.score) best = { cols, minN, minC, score, minContrast: contrastMin };
    }
  }
  return { colors: best.cols, minNormal: +best.minN.toFixed(1), minCvd: +best.minC.toFixed(1), minContrast: +best.minContrast.toFixed(2),
           ok: best.minC >= 8 && best.minN >= 15 && best.minContrast >= 3 };
}

// The lightest colour of a hue that white text still reads on (contrast 5 or more). Slide header bands use it.
function carriesWhite(C, h) {
  for (let L = 0.6; L > 0.2; L -= 0.02) { const c = oklch(L, C, h); if (contrast(c, '#ffffff') >= 5) return c; }
  return oklch(0.2, C, h);
}
const rule = (selector, vars) => selector + '{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + '}';

function makeTheme(accentHex, mode = 'dark') {
  const h = hueOf(accentHex), dark = mode !== 'light';
  const hl = Math.abs(((h - 75 + 540) % 360) - 180) < 50 ? 205 : 75;   // 75 = amber
  const bg1 = dark ? oklch(0.13, 0.035, h) : oklch(0.985, 0.008, h);
  const bg2 = dark ? oklch(0.2, 0.05, (h + 15) % 360) : oklch(0.94, 0.025, (h + 15) % 360);
  const cat = categorical(h, mode, dark ? bg1 : bg1);
  const vars = {
    '--bg1': bg1, '--bg2': bg2,
    '--fg': dark ? '#ffffff' : oklch(0.2, 0.03, h), '--muted': dark ? oklch(0.78, 0.02, h) : oklch(0.45, 0.03, h),
    '--c1': oklch(dark ? 0.74 : 0.52, 0.14, h), '--c2': oklch(dark ? 0.42 : 0.38, 0.13, h), '--c3': oklch(dark ? 0.62 : 0.5, 0.15, h),
    '--c5': oklch(dark ? 0.8 : 0.55, 0.12, (h + 60) % 360), '--acc': oklch(dark ? 0.86 : 0.5, 0.1, h),
    // emphasis colour: neutral amber, or cyan when the accent itself is amber; never an arbitrary complement
    '--hl1': oklch(dark ? 0.8 : 0.72, 0.15, hl), '--hl2': oklch(dark ? 0.64 : 0.56, 0.16, hl),
    // meaning colours for tone=good|bad
    '--good1': oklch(dark ? 0.76 : 0.6, 0.17, 150), '--good2': oklch(dark ? 0.6 : 0.5, 0.17, 150),
    '--bad1': oklch(dark ? 0.7 : 0.6, 0.19, 25), '--bad2': oklch(dark ? 0.55 : 0.5, 0.2, 25),
    '--vio': oklch(dark ? 0.45 : 0.8, 0.17, (h + 40) % 360), '--blob-o': dark ? '0.55' : '0.30',
    // slide header bands: the accent and a neighbouring hue, both dark enough for white text in either mode
    '--band1': carriesWhite(0.15, h), '--band2': carriesWhite(0.16, (h + 40) % 360),
  };
  cat.colors.forEach((c, i) => { vars['--d' + (i + 1)] = c; });
  return { vars, css: rule(':root,body', vars), report: { minNormal: cat.minNormal, minCvd: cat.minCvd, minContrast: cat.minContrast, ok: cat.ok } };
}

// Ready looks for slide decks, as data: a starting accent and mode, a backdrop, and values for the slide
// variables that src/template.html declares. Colours are written against the palette (--fg, --c1 ...), so a
// look keeps working when accent= or mode= replaces its own. The backdrop is used while the mode is the look's.
const LOOKS = {
  midnight: {   // dark navy, glass cards
    accent: '#6ea8ff', mode: 'dark', bg: ['#0a1026', '#16214a'],
    vars: {
      '--card': 'color-mix(in srgb, var(--fg) 8%, transparent)', '--line': 'color-mix(in srgb, var(--fg) 20%, transparent)',
      '--blur': 'blur(14px)', '--glow': '0 16px 36px rgba(0,0,0,.28)', '--blob-o': '0.7',
    },
  },
  paper: {      // warm light, serif headings
    accent: '#b4532a', mode: 'light', bg: ['#faf6ec', '#f2e9d8'],
    vars: {
      '--head-font': '"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif',
      '--line': 'color-mix(in srgb, var(--fg) 18%, transparent)', '--edge': 'linear-gradient(var(--line),var(--line))',
      '--band': 'linear-gradient(var(--band1),var(--band1))', '--ring-edge': 'conic-gradient(var(--c3),var(--c2),var(--c3))', '--blob-o': '0',
    },
  },
  neon: {       // near black, glowing accent borders
    accent: '#19e6b8', mode: 'dark', bg: ['#050509', '#0c0c16'],
    vars: {
      '--panel': 'color-mix(in srgb, var(--fg) 3%, var(--bg1))', '--card': 'color-mix(in srgb, var(--fg) 5%, var(--bg1))',
      '--line': 'var(--c1)', '--edge': 'linear-gradient(135deg,var(--c1),var(--c5))',
      '--glow': '0 0 18px color-mix(in srgb, var(--c1) 50%, transparent)', '--blob-o': '0.25',
    },
  },
};
// A look as CSS. [data-mode] is on the page and on every slide that has its own mode, so the variables are
// worked out again wherever the palette changes.
function lookCss(name, mode) {
  const look = LOOKS[name];
  return (mode === look.mode ? rule(':root,body', { '--bg1': look.bg[0], '--bg2': look.bg[1] }) : '') + rule('[data-mode]', look.vars);
}

module.exports = { makeTheme, LOOKS, lookCss, rule, luminance, hueOf, contrast, dE, hexToOklab, simulate, CVD };
