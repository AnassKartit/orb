#!/usr/bin/env node
// Prism: a tiny motion-graphics language. Compiles .prism to one self-contained HTML file.
const fs = require('fs');
const path = require('path');
const { expand, LangError } = require('./lang');
const { makeTheme } = require('./theme');
const FONT_STACKS = {
  sans: 'Inter,"Segoe UI",system-ui,-apple-system,sans-serif',
  serif: '"Iowan Old Style","Palatino Linotype",Georgia,"Times New Roman",serif',
  mono: 'ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace',
  rounded: '"Nunito","Segoe UI Variable Display","Trebuchet MS",system-ui,sans-serif',
  display: '"Segoe UI Black","Arial Black","Helvetica Neue",Impact,sans-serif',
  condensed: '"Bahnschrift","Arial Narrow","Roboto Condensed",sans-serif',
};

const ELEMENTS = ['eyebrow', 'title', 'sub', 'text', 'count', 'bars', 'line', 'donut', 'shape', 'orb',
  // slide kit
  'world', 'toy', 'stage', 'mascot', 'act', 'camera', 'audio', 'machine', 'input', 'state', 'on',
  'diagram', 'node', 'edge', 'zone', 'shot', 'caption',
  'table', 'tabs', 'legend',
  'heading', 'lede', 'panel', 'grid', 'row', 'col', 'card', 'steps', 'outcome', 'bullets', 'banner', 'hub', 'cover', 'divider', 'image', 'plus', 'note'];
const CONTAINERS = ['machine', 'state', 'panel', 'grid', 'row', 'col', 'world', 'stage', 'table', 'diagram'];
const VERBS = ['talk', 'nod', 'wave', 'laugh', 'look', 'idle', 'cheer', 'sad', 'hop', 'feel'];
const MOODS = ['neutral', 'happy', 'sad', 'surprised', 'angry', 'sleepy', 'love'];
const LAYOUTS = ['stack', 'columns', 'left', 'slide'];
const ANIMS = ['lift', 'wipe', 'fade', 'rise', 'pop', 'slide-l', 'slide-r', 'type', 'blur', 'grow', 'draw', 'sweep', 'count', 'none'];
const EASES = ['out', 'inout', 'back', 'linear', 'expo', 'spring'];
const EASE_FN = /^(spring\([\d.]+\)|(in|out|inOut)\([\d.]+\))$/;
const THEMES = ['slate', 'aurora', 'sunset', 'paper', 'ms'];
const DEFAULT_IN = { eyebrow: 'fade', rule: 'grow', title: 'rise', sub: 'fade', text: 'fade', count: 'count', bars: 'grow', line: 'draw', donut: 'sweep', shape: 'pop', orb: 'pop',
  diagram: 'none', node: 'none', edge: 'none', zone: 'none', shot: 'none', caption: 'none', table: 'none', tabs: 'fade', legend: 'fade', world: 'none', stage: 'none', mascot: 'none', toy: 'none', act: 'none', camera: 'none', audio: 'none',
  heading: 'lift', lede: 'fade', panel: 'lift', grid: 'none', row: 'none', col: 'none', card: 'lift', steps: 'lift', outcome: 'lift', bullets: 'fade',
  banner: 'wipe', hub: 'pop', cover: 'fade', divider: 'fade', image: 'fade', plus: 'pop', note: 'fade' };

class PrismError extends Error {
  constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function expect(line, kind, value, allowed) {
  if (allowed.includes(value)) return value;
  const best = allowed.map(a => [a, distance(a, value)]).sort((x, y) => x[1] - y[1])[0];
  const hint = best && best[1] <= 2 ? `, did you mean '${best[0]}'?` : `. Options: ${allowed.join(', ')}`;
  throw new PrismError(line, `unknown ${kind} '${value}'${hint}`);
}

const seconds = (s) => {
  const n = parseFloat(String(s).replace(/s$/, ''));
  return Number.isFinite(n) ? n : null;
};

function tokenize(src, lineNo) {
  const out = { text: [], args: [], named: {} };
  const re = /([\w-]+)=("[^"]*"|\S+)|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) out.named[m[1]] = m[2].replace(/^"|"$/g, '');
    else if (m[3] !== undefined) out.text.push(m[3]);
    else out.args.push(m[4]);
  }
  return out;
}

const player = require('./player-parser')({ PrismError, expect, tokenize, VERBS, MOODS });

function parse(source, opts = {}) {
  const expanded = expand(source, { dialect: 'player', baseDir: opts.baseDir || '.', file: opts.sourceFile });
  const lines = expanded.text.split(/\r?\n/);
  let motion = null, scene = null, cursor = 0, stack = [];
  lines.forEach((raw, i) => {
    const n = expanded.map[i] || i + 1;
    const body = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
    if (!body.trim()) return;
    const indent = body.match(/^ */)[0].length;
    if (indent % 2) throw new PrismError(n, 'indent with 2 spaces per level');
    const trimmed = body.trim();
    const head = trimmed.split(/\s+/)[0];
    const rest = trimmed.slice(head.length);
    const tk = tokenize(rest, n);

    if (indent === 0) {
      if (head !== 'motion') throw new PrismError(n, `file must start with 'motion', found '${head}'`);
      motion = { title: tk.text[0] || 'Untitled', w: 1280, h: 720, dur: null, theme: 'slate', scenes: [] };
      for (const a of tk.args) {
        let m;
        if ((m = a.match(/^(\d+)x(\d+)$/))) { motion.w = +m[1]; motion.h = +m[2]; }
        else if (seconds(a) !== null) motion.dur = seconds(a);
        else throw new PrismError(n, `unexpected '${a}' on motion line (expected WxH or a duration like 8s)`);
      }
      if (tk.named.bg) { motion.theme = expect(n, 'theme', tk.named.bg, THEMES); motion.explicitBg = tk.named.bg !== 'slate'; }   // 'slate' is the old default, so it does not count as a chosen look
      if (tk.named.accent) { if (!/^#[0-9a-fA-F]{6}$/.test(tk.named.accent)) throw new PrismError(n, "accent must look like #0f6cbd"); motion.accent = tk.named.accent; }
      if (tk.named.font) motion.font = FONT_STACKS[tk.named.font] || `"${tk.named.font.replace(/"/g, '')}",${FONT_STACKS.sans}`;
      if (tk.named.numbers) motion.numbers = tk.named.numbers === 'on';
      if (tk.named.present) motion.present = tk.named.present === 'on';
      if (tk.named.loop) motion.loop = tk.named.loop === 'on';
      if (tk.named.corner) motion.cornerFile = tk.named.corner;
      if (tk.named.speed) { motion.speed = parseFloat(tk.named.speed); if (!(motion.speed > 0.2 && motion.speed < 5)) throw new PrismError(n, 'speed must be between 0.2 and 5'); }
      if (tk.named.mode) motion.mode = expect(n, 'mode', tk.named.mode, ['dark', 'light']);
      return;
    }
    if (!motion) throw new PrismError(n, "file must start with a 'motion' line");

    if (indent === 2) {
      expect(n, 'block', head, ['scene']);
      const a = tk.args[0] || '';
      let start, end, m;
      if ((m = a.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s?$/))) { start = +m[1]; end = +m[2]; }
      else if (seconds(a) !== null) { start = cursor; end = cursor + seconds(a); }
      else throw new PrismError(n, "scene needs a time: 'scene 0-3s' or 'scene 3s'");
      if (end <= start) throw new PrismError(n, 'scene must end after it starts');
      cursor = end;
      stack = [];
      scene = { start, end, els: [], layout: tk.named.layout ? expect(n, 'layout', tk.named.layout, LAYOUTS) : null };
      motion.scenes.push(scene);
      return;
    }
    if (indent >= 4) {
      if (!scene) throw new PrismError(n, 'element outside a scene');
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const metaParent = stack.length ? stack[stack.length - 1].el : null;
      const meta = player.line(head, rest, tk, n, metaParent);
      if (meta) {
        (metaParent ? metaParent.children : scene.els).push(meta);
        stack.push({ indent, el: meta });
        return;
      }
      expect(n, 'element', head, ELEMENTS);
      const el = { type: head, text: tk.text, args: tk.args, named: {}, line: n };
      for (const [k, v] of Object.entries(tk.named)) el.named[k] = v;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].el : null;
      if (parent && !CONTAINERS.includes(parent.type)) throw new PrismError(n, `'${parent.type}' cannot contain other elements (containers: ${CONTAINERS.join(', ')})`);
      const siblings = parent ? parent.children : scene.els;
      const inA = el.named.in || DEFAULT_IN[head];
      el.in = expect(n, 'animation', inA, ANIMS);
      if (el.named.ease) el.ease = EASE_FN.test(el.named.ease) ? el.named.ease : expect(n, 'ease', el.named.ease, EASES);
      const prev = siblings[siblings.length - 1];
      const atRaw = el.named.at;
      if (atRaw === undefined) el.at = parent ? parent.at + 0.2 + siblings.length * 0.09 : siblings.length * 0.35;
      else if (atRaw[0] === '+') el.at = (prev ? prev.at + prev.dur : 0) + (seconds(atRaw.slice(1)) || 0);   // after the previous element ends
      else if (atRaw[0] === '<') el.at = (prev ? prev.at : 0) + (seconds(atRaw.slice(1)) || 0);              // together with the previous one
      else el.at = seconds(atRaw);
      if (head === 'act' || head === 'camera') el.dur = el.named.dur !== undefined ? seconds(el.named.dur) : 2;
      else el.dur = el.named.dur !== undefined ? seconds(el.named.dur) : (head === 'bars' || head === 'donut' || head === 'line' ? 1.2 : head === 'orb' ? 1.1 : 0.8);
      el.stagger = el.named.stagger !== undefined ? seconds(el.named.stagger) : 0.05;
      for (const k of ['at', 'dur', 'stagger', 'in', 'ease']) delete el.named[k];
      if (el.named.from) expect(n, 'stagger origin', el.named.from, ['first', 'last', 'center']);
      if ((head === 'audio' || (head === 'act' && el.named.audio)) && tk.named.dur === undefined) el.autoDuration = true;
      player.validateMedia(el, tk.named);
      validate(el);
      if (CONTAINERS.includes(head)) el.children = [];
      siblings.push(el);
      stack.push({ indent, el });
      return;
    }
    throw new PrismError(n, 'too deeply indented; scenes hold elements, elements hold nothing');
  });
  if (!motion) throw new PrismError(1, "empty file; start with: motion \"Title\" 1280x720 8s");
  if (!motion.scenes.length) throw new PrismError(1, 'add at least one scene, e.g. "  scene 0-3s"');
  player.finish(motion);
  motion.scenes.forEach(sc => compose(sc, motion));
  if (motion.speed && motion.speed !== 1) {   // faster builds: scale every element's timing (scene lengths stay as authored)
    const scale = els => els.forEach(e => { e.at /= motion.speed; e.dur /= motion.speed; e.stagger /= motion.speed; if (e.children) scale(e.children); });
    motion.scenes.forEach(sc => scale(sc.els));
  }
  const last = Math.max(...motion.scenes.map(s => s.end));
  if (motion.dur === null) motion.dur = last;
  return motion;
}

// Automatic composition: authors describe content; the compiler picks a designed layout.
const DECK = ['table', 'tabs', 'legend', 'heading', 'lede', 'panel', 'grid', 'row', 'col', 'card', 'steps', 'outcome', 'bullets', 'banner', 'hub', 'cover', 'divider', 'image', 'plus', 'note'];
function compose(sc, motion) {
  if (!sc.layout && sc.els.some(e => DECK.includes(e.type))) { sc.layout = 'slide'; return; }
  const charts = sc.els.filter(e => ['bars', 'line', 'donut'].includes(e.type)).length;
  const hasCount = sc.els.some(e => e.type === 'count');
  if (!sc.layout) sc.layout = charts >= 2 ? 'columns' : (hasCount && charts >= 1 ? 'left' : 'stack');
  const width = { stack: 760, columns: 500, left: 1040 }[sc.layout];
  for (const e of sc.els) { if (e.type === 'bars' || e.type === 'line') e.w = width; if (e.type === 'donut') { const parts = Object.values(e.named).filter(v => Number.isFinite(parseFloat(v))).length; e.w = sc.layout === 'columns' ? (parts > 3 ? 240 : 300) : 340; } }
  // chart scenes with no heading get one from the piece title
  if (charts && !sc.els.some(e => ['title', 'eyebrow', 'sub'].includes(e.type)))
    sc.els.unshift({ type: 'eyebrow', text: [motion.title.toUpperCase()], args: [], named: {}, in: 'fade', at: 0, dur: 0.6, stagger: 0, line: sc.els[0].line });
  // a title with a subtitle gets an accent rule under it
  const i = sc.els.findIndex(e => e.type === 'sub');
  if (i >= 0 && sc.els.some(e => e.type === 'title')) {
    const sub = sc.els[i];
    sc.els.splice(i + 1, 0, { type: 'rule', text: [], args: [], named: {}, in: 'grow', at: sub.at + 0.35, dur: 0.6, stagger: 0, line: sub.line });
  }
}

function validate(el) {
  const n = el.line;
  if (el.type === 'node' && (!el.args[0] || !el.text[0])) throw new PrismError(n, 'node needs an id and a label, e.g. node fw "Azure Firewall" icon=firewalls');
  if (el.type === 'edge' && !(el.args.length >= 3 && el.args[1] === '->')) throw new PrismError(n, 'edge looks like: edge a -> b label="text"');
  if (el.type === 'caption' && !el.text[0]) throw new PrismError(n, 'caption needs text, e.g. caption "Traffic enters the hub" at=3 dur=3');
  if (['tabs', 'legend'].includes(el.type) && !el.text.length) throw new PrismError(n, `${el.type} needs quoted labels, e.g. ${el.type} "One" "Two"`);
  if (el.type === 'mascot' && !el.text[0]) throw new PrismError(n, 'mascot needs a name, e.g. mascot "Hoot" color=#58cc02');
  if (el.type === 'mascot' && el.named.mood) expect(n, 'mood', el.named.mood, MOODS);
  if (el.type === 'toy' && !el.text[0]) throw new PrismError(n, 'toy needs a name, e.g. toy "Milo" shirt=#2f9aa0');
  if (el.type === 'act') {
    if (!el.text[0] || !el.args[0]) throw new PrismError(n, 'act needs a name and a verb, e.g. act "Milo" talk at=1 dur=3');
    // Words models naturally write: moods as verbs and common moves map to the real verbs.
    const alias = { jump: 'hop', bounce: 'hop', speak: 'talk', say: 'talk', celebrate: 'cheer', dance: 'cheer', blink: 'idle', smile: 'feel:happy', happy: 'feel:happy', surprised: 'feel:surprised', surprise: 'feel:surprised', angry: 'feel:angry', sleepy: 'feel:sleepy', love: 'feel:love', neutral: 'feel:neutral' }[el.args[0]];
    if (alias) { const [verb, mood] = alias.split(':'); el.args[0] = verb; if (mood) el.named.to = mood; }
    expect(n, 'verb', el.args[0], VERBS);
    const moodAlias = { excited: 'happy', joyful: 'happy', glad: 'happy', cheerful: 'happy', shocked: 'surprised', scared: 'surprised', amazed: 'surprised', mad: 'angry', furious: 'angry', tired: 'sleepy', bored: 'sleepy', upset: 'sad', unhappy: 'sad', calm: 'neutral', loving: 'love' };
    if (el.named.to && moodAlias[el.named.to]) el.named.to = moodAlias[el.named.to];
    if (el.named.mood && moodAlias[el.named.mood]) el.named.mood = moodAlias[el.named.mood];
    if (el.args[0] === 'feel') expect(n, 'mood', el.named.to || 'neutral', MOODS);
    if (el.type === 'act' && el.named.mood) expect(n, 'mood', el.named.mood, MOODS);
  }
  if (['heading', 'lede', 'card', 'banner', 'hub', 'cover', 'divider', 'note'].includes(el.type) && !el.text[0])
    throw new PrismError(n, `${el.type} needs quoted text, e.g. ${el.type} "Hello"`);
  if (['steps', 'bullets'].includes(el.type) && !el.text.length)
    throw new PrismError(n, `${el.type} needs one quoted string per item, e.g. ${el.type} "First" "Second"`);
  const nums = () => el.args.map(a => parseFloat(a)).filter(Number.isFinite);
  if (['eyebrow', 'title', 'sub', 'text'].includes(el.type) && !el.text[0])
    throw new PrismError(n, `${el.type} needs quoted text, e.g. ${el.type} "Hello"`);
  if (el.type === 'count' && (!el.text[0] || !el.args[0]))
    throw new PrismError(n, 'count needs a label and a value, e.g. count "Revenue" $1.2M');
  if (el.type === 'bars') {   // a label must not contradict the value it highlights
    const LOW = /\b(lowest|minimum|min|least|smallest|bottom|fewest)\b/i, HIGH = /\b(highest|maximum|max|most|largest|best|top|peak)\b/i;
    if (el.named.peak && LOW.test(el.named.peak)) throw new PrismError(n, `peak marks the HIGHEST bar but "${el.named.peak}" describes the lowest; use low="${el.named.peak}" instead`);
    if (el.named.low && HIGH.test(el.named.low)) throw new PrismError(n, `low marks the LOWEST bar but "${el.named.low}" describes the highest; use peak="${el.named.low}" instead`);
    if (el.named.peak && el.named.low) throw new PrismError(n, 'use either peak= or low=, not both');
    if (el.named.tone) expect(n, 'tone', el.named.tone, ['good', 'bad', 'neutral']);
  }
  if ((el.type === 'bars' || el.type === 'line') && nums().length < 2)
    throw new PrismError(n, `${el.type} needs at least two numbers, e.g. ${el.type} 12 18 15`);
  if (el.type === 'donut') {
    const vals = Object.values(el.named).map(parseFloat).filter(Number.isFinite);
    if (vals.length < 2) throw new PrismError(n, 'donut needs two or more slices, e.g. donut web=52 app=31');
  }
}

const ICON_DIR = process.env.ORB_ICONS || path.join(__dirname, '..', 'icons');
function resolveIcon(name, line, baseDir) {
  if (/[\\/]/.test(name) || name.endsWith('.svg')) return path.resolve(baseDir, name);
  for (const cand of [name, 'azure-' + name]) { const f = path.join(ICON_DIR, cand + '.svg'); if (fs.existsSync(f)) return f; }
  let hint = '';
  try {
    const all = fs.readdirSync(ICON_DIR).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4));
    const best = all.map(a => [a, distance(a, name)]).sort((x, y) => x[1] - y[1]).slice(0, 3).map(x => x[0]);
    hint = `. Closest: ${best.join(', ')}`;
  } catch (e) { hint = `. Icon folder not found (${ICON_DIR}); set ORB_ICONS`; }
  throw new PrismError(line, `icon '${name}' not found${hint}`);
}

// Automatic diagram layout: layers by flow depth, left to right; authors may still pin a node with x= and y= (0..1).
function layoutDiagram(d) {
  const nodes = d.children.filter(c => c.type === 'node'), edges = d.children.filter(c => c.type === 'edge');
  const byId = Object.fromEntries(nodes.map(n => [n.args[0], n]));
  for (const e of edges) for (const id of [e.args[0], e.args[2]]) if (!byId[id]) throw new PrismError(e.line, `edge refers to unknown node '${id}'. Nodes: ${Object.keys(byId).join(', ')}`);
  const depth = Object.fromEntries(nodes.map(n => [n.args[0], 0]));
  for (let pass = 0; pass < nodes.length; pass++) for (const e of edges) depth[e.args[2]] = Math.max(depth[e.args[2]], Math.min(depth[e.args[0]] + 1, nodes.length));
  const layers = {};
  nodes.forEach(n => { n.depth = depth[n.args[0]]; (layers[n.depth] = layers[n.depth] || []).push(n); });
  const cols = Math.max(...Object.keys(layers).map(Number)) + 1;
  Object.entries(layers).forEach(([L, list]) => list.forEach((n, i) => {
    if (n.named.x === undefined) n.px = 0.1 + 0.8 * ((+L + 0.5) / cols);
    else n.px = parseFloat(n.named.x);
    if (n.named.y === undefined) n.py = 0.24 + 0.6 * ((i + 0.5) / list.length);
    else n.py = parseFloat(n.named.y);
  }));
  // appear order: by layer, then by position
  nodes.slice().sort((a, b) => a.depth - b.depth).forEach((n, k) => { n.appear = n.named.at !== undefined ? n.at : 0.4 + k * 0.28; });
  edges.forEach(e => { e.appear = Math.max(byId[e.args[0]].appear, byId[e.args[2]].appear) + 0.35; });
}

// Images are embedded once per file in motion.assets and referenced by id, so a picture used on many slides costs its bytes once.
function inlineImages(els, baseDir, assets) {
  for (const el of els) {
    if (el.type === 'diagram') layoutDiagram(el);
    for (const key of (el.type === 'node' ? ['image', 'logo', 'icon'] : ['image', 'logo'])) {   // icon= is a file only on diagram nodes; elsewhere it names a built-in glyph
    const img = el.named[key];
    if (img && img[0] !== '@' && !/^data:/.test(img)) {
      const file = key === 'icon' ? resolveIcon(img, el.line, baseDir) : path.resolve(baseDir, img);
      if (!fs.existsSync(file)) throw new PrismError(el.line, `image '${img}' not found (looked in ${baseDir})`);
      if (!assets[file]) {
        const ext = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml');
        assets[file] = { id: 'a' + Object.keys(assets).length, uri: `data:image/${ext};base64,${fs.readFileSync(file).toString('base64')}` };
      }
      el.named[key] = '@' + assets[file].id;
    }
    }
    if (el.children) inlineImages(el.children, baseDir, assets);
  }
}

const AUTO_ACCENTS = ['#0ea5a4', '#7c5cff', '#f97316', '#22c55e', '#3b82f6', '#e11d48', '#eab308', '#06b6d4'];
const AUTO_FONTS = ['sans', 'rounded', 'condensed', 'sans', 'serif', 'rounded', 'sans', 'display'];
function compile(source, opts = {}) {
  const motion = parse(source, opts);
  if (!motion.accent && !motion.explicitBg && !motion.autoOff) {   // no look chosen: derive a distinct, validated one from the title
    let hsh = 0; for (const ch of motion.title) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    motion.accent = AUTO_ACCENTS[hsh % AUTO_ACCENTS.length]; motion.mode = motion.mode || 'dark';
    if (!motion.font) motion.font = FONT_STACKS[AUTO_FONTS[(hsh >>> 3) % AUTO_FONTS.length]];
  }
  const assets = {};
  if (motion.cornerFile) { const holder = { named: { image: motion.cornerFile }, line: 1 }; inlineImages([holder], opts.baseDir || process.cwd(), assets); motion.corner = holder.named.image; }
  for (const sc of motion.scenes) inlineImages(sc.els, opts.baseDir || process.cwd(), assets);
  motion.assets = Object.fromEntries(Object.values(assets).map(a => [a.id, a.uri]));
  if (motion.accent) { const t = makeTheme(motion.accent, motion.mode); motion.themeCss = t.css; motion.themeReport = t.report; }
  if (motion.font) motion.themeCss = (motion.themeCss || '') + `:root,body{--font:${motion.font}}`;
  require('./player-audio').prepare(motion, opts.baseDir || process.cwd(), PrismError);
  const scene = JSON.stringify(motion).replace(/</g, '\\u003c');
  const dir = __dirname;
  const template = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
  let runtime = fs.readFileSync(path.join(dir, 'runtime.js'), 'utf8');
  if (motion.audioAssets || motion.interactive || motion.playerTalk) runtime = require('./player-runtime').enhance(runtime);
  const has3d = els => els.some(e => e.type === 'orb' || e.type === 'world' || (e.children && has3d(e.children)));
  const uses3d = motion.scenes.some(sc => has3d(sc.els));
  const three = uses3d ? fs.readFileSync(path.join(dir, '..', 'vendor', 'three.min.js'), 'utf8') : '';
  return template
    .replace('/*THREE*/', () => three)
    .replace('/*THEME*/', () => motion.themeCss || '')
    .replace('__TITLE__', motion.title.replace(/[<&>]/g, ''))
    .replace('__SCENE__', () => scene)
    .replace('/*RUNTIME*/', () => runtime);
}

module.exports = { compile, parse, PrismError, LangError };

if (require.main === module) {
  const args = process.argv.slice(2);
  // One command line for every kind of file. A file with scenes (decks, charts, characters) builds to an
  // interactive page; anything else builds to a HyperFrames video project.
  const isPlayer = file => /\.prism$/.test(file) || /^ {2}scene(\s|$)/m.test(fs.readFileSync(file, 'utf8'));
  if (args[0] === 'mcp') { require('./mcp').serve(); return; }   // orb mcp: tools for AI agents over stdio
  if (args[0] === 'expand') {
    const file = args[1];
    if (!file) { console.error('usage: orb expand file.orb   (prints the file with every def, repeat, if and import expanded)'); process.exit(2); }
    try {
      const src = fs.readFileSync(file, 'utf8'), baseDir = path.dirname(path.resolve(file)), sourceFile = path.resolve(file);
      const out = isPlayer(file) ? expand(src, { dialect: 'player', baseDir, file: sourceFile }) : require('./hf').expandSource(src, { baseDir, sourceFile });
      console.log(out.text);
    } catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  if (args[0] === 'build' && args.includes('--target')) {   // --target web: one page that plays in any browser
    try { require('./web').cli(args.slice(1)); }
    catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  if (['build', 'check'].includes(args[0]) && args[1] && fs.existsSync(args[1]) && isPlayer(args[1])) {
    const file = args[1], oi = args.indexOf('-o');
    let out = oi >= 0 ? args[oi + 1] : file.replace(/\.(prism|orb)$/, '') + '.html';
    if (!/\.html$/.test(out)) { fs.mkdirSync(out, { recursive: true }); out = path.join(out, 'index.html'); }
    try {
      const html = compile(fs.readFileSync(file, 'utf8'), { baseDir: path.dirname(path.resolve(file)), sourceFile: path.resolve(file) });
      if (args[0] === 'build') { fs.writeFileSync(out, html); console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB, interactive page)`); }
      else console.log('ok');
    } catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  if (['build','check'].includes(args[0])) {
    try { require('./hf').cli(args.slice(1),args[0]); }
    catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  if (args[0] === 'preview') {
    try { require('./orb-render').preview(args.slice(1)); }
    catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  if (args[0] === 'render') {
    try { require('./orb-render').render(args.slice(1)); }
    catch (e) { console.error(`orb: ${e.message}`); process.exit(1); }
    return;
  }
  const file = args.find(a => !a.startsWith('-'));
  if (!file) { console.error('usage: prism <file.prism> [-o out.html] [--tokens]'); process.exit(2); }
  const oi = args.indexOf('-o');
  const out = oi >= 0 ? args[oi + 1] : file.replace(/\.prism$/, '') + '.html';
  const src = fs.readFileSync(file, 'utf8');
  try {
    const html = compile(src, { baseDir: path.dirname(path.resolve(file)) });
    fs.writeFileSync(out, html);
    console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
    if (args.includes('--tokens')) {
      const est = s => Math.ceil(s.length / 4);
      const m = parse(src);
      console.log(`source: ~${est(src)} tokens, ${m.scenes.length} scenes, ${m.dur}s of motion`);
    }
  } catch (e) {
    if (e instanceof PrismError || e instanceof LangError) { console.error(`prism: ${e.message}`); process.exit(1); }
    throw e;
  }
}
