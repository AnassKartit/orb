// Web target for video files: one page that plays an Orb video in any browser.
// The video compiler (hf.js) writes a project: index.html, compositions/<id>.html and assets/. page() folds that
// project into a single document and inlines web-runtime.js, which does in the browser what the video renderer
// does for each frame: mount the compositions, show each clip inside its time span, seek every timeline.
const fs = require('fs');
const path = require('path');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', js: 'text/javascript',
};
// Font families the video renderer resolves by name, with the weights that exist. The page loads the faces it
// uses from the public Fontsource files (Latin subset), so text has the same shapes and widths as in the video.
const hundreds = (from, to) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);
const WEB_FONTS = {
  'Inter': hundreds(100, 900), 'Montserrat': hundreds(100, 900), 'Outfit': hundreds(100, 900), 'Nunito': hundreds(200, 900),
  'Oswald': hundreds(200, 700), 'League Gothic': [400], 'Archivo Black': [400], 'Space Mono': [400, 700],
  'IBM Plex Mono': hundreds(100, 700), 'JetBrains Mono': hundreds(100, 800), 'EB Garamond': hundreds(400, 800),
  'Playfair Display': hundreds(400, 900), 'Source Code Pro': hundreds(200, 900), 'Noto Sans JP': hundreds(100, 900),
  'Roboto': hundreds(100, 900), 'Open Sans': hundreds(300, 800), 'Lato': [100, 300, 400, 700, 900], 'Poppins': hundreds(100, 900),
};
const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';

// A file with scene blocks is a player file (deck, chart, character); anything else is a video file.
const isPlayer = (file, source) => /\.prism$/.test(file || '') || /^ {2}scene(\s|$)/m.test(source);

// The type of a file: from its first bytes when they are telling (a file replaced under its old name keeps
// working), otherwise from its extension.
const SIGNATURES = [
  [/^\x89PNG/, 'image/png'], [/^\xff\xd8\xff/, 'image/jpeg'], [/^GIF8/, 'image/gif'], [/^RIFF....WEBP/s, 'image/webp'],
  [/^RIFF....WAVE/s, 'audio/wav'], [/^....ftypavi[fs]/s, 'image/avif'], [/^....ftypM4A/s, 'audio/mp4'], [/^....ftypqt/s, 'video/quicktime'],
  [/^....ftyp/s, 'video/mp4'], [/^\x1a\x45\xdf\xa3/, 'video/webm'], [/^OggS/, 'audio/ogg'], [/^(?:ID3|\xff[\xfb\xf3\xf2])/, 'audio/mpeg'],
  [/^wOF2/, 'font/woff2'], [/^wOFF/, 'font/woff'], [/^(?:\xef\xbb\xbf)?\s*<(?:\?xml|svg|!DOCTYPE svg)/i, 'image/svg+xml'],
];
function mime(name, data) {
  const head = !data ? '' : typeof data === 'string' ? data.slice(0, 64) : String.fromCharCode(...data.slice(0, 64));
  const known = SIGNATURES.find(([signature]) => signature.test(head));
  return known ? known[1] : MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
}
function base64(data) {
  if (typeof Buffer !== 'undefined') return Buffer.from(data).toString('base64');
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
  return btoa(binary);
}
const dataUrl = (name, data) => typeof data === 'string' ? `data:${mime(name, data)};charset=utf-8,${encodeURIComponent(data)}` : `data:${mime(name, data)};base64,${base64(data)}`;

// @font-face rules for the named families a page uses and does not declare itself.
function webFonts(html) {
  const rules = [];
  for (const [family, weights] of Object.entries(WEB_FONTS)) {
    const name = family.replace(/ /g, '\\s+');
    if (!new RegExp(`font(?:-family)?\\s*:(?:[^;{}<>]|&quot;)*\\b${name}\\b`, 'i').test(html)) continue;
    if (new RegExp(`@font-face\\s*\\{[^}]*font-family\\s*:\\s*["']?${name}["']?\\s*[;}]`, 'i').test(html)) continue;
    const slug = family.toLowerCase().replace(/ /g, '-');
    for (const weight of weights) {
      rules.push(`@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url("${FONT_CDN}/${slug}@5/files/${slug}-latin-${weight}-normal.woff2") format("woff2")}`);
    }
  }
  return rules.join('\n');
}

// Split CSS into its top-level rules, minding strings and nested blocks.
function cssRules(css) {
  const rules = []; let depth = 0, start = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' ? --depth === 0 : c === ';' && depth === 0) { rules.push(css.slice(start, i + 1).trim()); start = i + 1; }
  }
  return rules;
}
// Keep a composition's CSS inside its host. "#root" means the composition's own root. Rules that are global by
// nature (@font-face, @keyframes) go to `globals`, once each.
const GLOBAL_RULE = /^@(?:font-face|(?:-webkit-)?keyframes|import|property|charset|namespace|counter-style|font-feature-values)\b/i;
function scopeCss(css, id, globals) {
  const own = [];
  for (const rule of cssRules(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    if (GLOBAL_RULE.test(rule)) globals.add(rule);
    else own.push(rule.replace(/#root(?![\w-])/g, '&>[data-orb-root]'));
  }
  return own.length ? `[data-composition-id="${id}"]{${own.join('')}}` : '';
}

// files: { 'index.html': text, 'compositions/<id>.html': text, 'assets/<name>': bytes or text } -> one HTML page.
// options.embed (default true) inlines local assets as data URLs; false keeps "assets/<name>" for a folder.
// options.media false leaves pictures, video and audio out of the page: whoever shows the page hands their URLs
// to __orb.media({ name: url }). The playground does, so a large video is not encoded again on every edit.
function page(files, options = {}) {
  const text = name => typeof files[name] === 'string' ? files[name] : new TextDecoder().decode(files[name]);
  let html = text('index.html');
  const mainScript = html.lastIndexOf('<script>'), bodyEnd = html.lastIndexOf('</body>');
  if (!html.includes('</head>') || mainScript < 0 || bodyEnd < mainScript) throw new Error('index.html is not an Orb video build');

  const globals = new Set(), styles = [], templates = [], scripts = [], externals = new Set();
  for (const name of Object.keys(files).filter(n => /^compositions\/[^/]+\.html$/.test(n)).sort()) {
    const id = path.basename(name, '.html');
    const markup = text(name).replace(/^[\s\S]*?<template[^>]*>/, '').replace(/<\/template>\s*$/, '')
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (all, css) => { styles.push(scopeCss(css, id, globals)); return ''; })
      .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (all, attrs, code) => {
        const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i) || [])[1] || '';
        if (type && !/javascript|ecmascript/i.test(type)) return all;   // data blocks and modules stay in the markup
        if (/\bsrc\s*=/i.test(attrs)) { externals.add(all); return ''; }   // libraries load once, in the head
        // One function per script: they all declare `const tl`. The runtime calls them once the fonts are in.
        const own = code.replace(/#root(?![\w-])/g, `[data-composition-id=${id}]>[data-orb-root]`);   // no quotes: it may sit inside a string
        scripts.push(`<script>__orb.composition(${JSON.stringify(id)},function(){${own}\n});</script>`);
        return '';
      });
    templates.push(`<template data-orb-composition="${name}">${markup}</template>`);
  }
  const mainCss = (html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i) || ['', ''])[1];
  const own = [...[...globals].filter(rule => !mainCss.includes(rule)), ...styles].filter(Boolean).join('\n');
  const css = [webFonts(html + templates.join('') + own), own].filter(Boolean).join('\n');

  // Page order: main markup, composition templates, the runtime (it mounts the templates), the main script,
  // then one registered function per composition script.
  const RUNTIME = '<!--orb-web-runtime-->';
  html = html.slice(0, mainScript) + templates.join('\n') + RUNTIME + html.slice(mainScript, bodyEnd) + '\n' + scripts.join('\n') + html.slice(bodyEnd);
  html = html.replace('</head>', () => `${[...externals].join('')}<style>${css}</style></head>`);
  let table = '';
  if (options.embed !== false) {
    // A media file is stored once, however many elements play it: they name it in data-orb-src and the runtime
    // sets their src. Every other reference (CSS url(), scripts) gets the data URL in place.
    const urls = {}, stored = {}, url = name => urls[name] ??= dataUrl(name, files[name]);
    html = html.replace(/<(?:img|video|audio|source)\b[^>]*>/gi, tag => tag.replace(/\bsrc=(["'])(assets\/[^"']+)\1/, (all, quote, name) => {
      if (files[name] === undefined) return all;
      if (options.media !== false) stored[name] = url(name);
      return `data-orb-src=${quote}${name}${quote}`;
    }));
    for (const name of Object.keys(files).filter(n => n.startsWith('assets/'))) {
      html = html.replace(new RegExp(`(?<!data-orb-src=["'])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), () => url(name));
    }
    if (options.media !== false) table = `<script type="application/json" id="orb-assets">${JSON.stringify(stored).replace(/</g, '\\u003c')}</script>\n`;
  }
  return html.replace(RUNTIME, () => `\n${table}<script>${fs.readFileSync(path.join(__dirname, 'web-runtime.js'), 'utf8')}</script>\n`);
}

// Read a built project from disk into the file map page() takes.
function read(dir) {
  const files = { 'index.html': fs.readFileSync(path.join(dir, 'index.html'), 'utf8') };
  for (const folder of ['compositions', 'assets']) {
    if (!fs.existsSync(path.join(dir, folder))) continue;
    for (const name of fs.readdirSync(path.join(dir, folder))) {
      files[`${folder}/${name}`] = folder === 'assets' ? fs.readFileSync(path.join(dir, folder, name)) : fs.readFileSync(path.join(dir, folder, name), 'utf8');
    }
  }
  return files;
}

// Video source -> { html, files, motion }. The project is built in options.workDir, or in a temporary folder
// that is removed afterwards. Other options go to the video compiler (baseDir, sourceFile, onWarning).
function build(source, options = {}) {
  const dir = options.workDir || fs.mkdtempSync(path.join(require('os').tmpdir(), 'orb-web-'));
  try {
    const motion = require('./hf').build(source, dir, options);
    const files = read(dir);
    return { html: page(files, options), files, motion };
  } finally {
    if (!options.workDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// orb build file.orb --target web [-o out.html | -o folder]
function cli(args) {
  let file, out, target;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') out = args[++i];
    else if (args[i] === '--target') target = args[++i];
    else if (args[i].startsWith('-')) throw new Error(`unknown argument '${args[i]}'`);
    else file ??= args[i];
  }
  if (target !== 'web') throw new Error(`unknown target '${target}'; available: web`);
  if (!file) throw new Error('usage: orb build file.orb --target web -o out.html   (or -o folder, which keeps assets as files)');
  const absolute = path.resolve(file), source = fs.readFileSync(absolute, 'utf8'), baseDir = path.dirname(absolute);
  out ||= file.replace(/\.(orb|prism)$/, '') + '.html';
  const single = /\.html?$/i.test(out), dest = single ? out : path.join(out, 'index.html');
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  let html;
  if (isPlayer(file, source)) html = require('./prism').compile(source, { baseDir, sourceFile: absolute });   // already one interactive page
  else {
    const built = build(source, { baseDir, sourceFile: absolute, embed: single, onWarning: message => console.error(message) });
    html = built.html;
    if (!single) {
      fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
      for (const [name, data] of Object.entries(built.files)) if (name.startsWith('assets/')) fs.writeFileSync(path.join(out, name), data);
    }
  }
  fs.writeFileSync(dest, html);
  console.log(`wrote ${dest} (${(html.length / 1024).toFixed(1)} KB, plays in any browser)`);
}

module.exports = { page, read, build, cli, isPlayer, mime, scopeCss, webFonts, WEB_FONTS };
