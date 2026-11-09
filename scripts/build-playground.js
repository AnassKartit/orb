#!/usr/bin/env node
// Builds playground/orb-compiler.js: the Orb compiler as one browser script. No bundler, no dependencies.
//
// Every CommonJS module under src/ that the compiler reaches is copied into a function and served by a small
// require(). The Node modules they ask for are replaced by stand-ins written below: a file system that lives in
// memory (it holds what the compiler reads while it runs: the page template, the player runtime, the standard
// library, the bundled sound effects), a posix path, sha256 and a child_process that can only say how long a
// video is and explains why it runs nothing else.
// The stand-ins are ordinary functions in this file; their source is copied into the bundle.
//
//   node scripts/build-playground.js        writes playground/orb-compiler.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

const ENTRIES = ['src/prism.js', 'src/hf.js', 'src/web.js', 'src/lang.js'];
// Command line pieces that start Chrome, ffmpeg or a server. Asking for one in the browser fails with a plain message.
const NODE_ONLY = ['src/hf-check.js', 'src/orb-render.js', 'src/mcp.js'];
const TEXT_FILES = ['src/template.html', 'src/runtime.js', 'src/web-runtime.js'];
// The samples menu, in order. A name that starts with a line count is checked against the file; the others get
// their count added, so the menu never claims a length the sample does not have.
const SAMPLES = [
  ['Swap the image and the colours', 'playground/examples/swap.orb'],
  ['3 lines: animated title', 'playground/examples/title.orb'],
  ['5 lines: counter and bar chart', 'playground/examples/counter.orb'],
  ['12 lines: data video', 'benchmark/runs/b1/orb.prism'],
  ['14 lines: interactive character, hover and click it', 'examples/interactive/hoot.prism'],
  ['Presentation', 'playground/examples/deck.orb'],
  ['Chart written in Orb', 'examples/std/charts-demo.orb'],
  ['Kinetic captions', 'examples/std/short-demo.orb'],
  ['Make it yours: colours, fonts, tags, a framed picture', 'playground/examples/customise.orb'],
  ['Four characters, one rig', 'examples/cartoon/cast.orb'],
  ['Deck looks: backgrounds, transitions, builds', 'playground/examples/deck-looks.orb'],
];
const countLines = text => text.split('\n').filter(line => line.trim()).length;
// Files the samples use. They start out in the folder a source builds from, like a file the visitor added.
const SAMPLE_FILES = ['playground/examples/placeholder.svg'];

// ---------- stand-ins for Node modules ----------
function makePath(cwd) {
  const normalize = p => {
    const parts = [];
    for (const part of p.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
    return (p.startsWith('/') ? '/' : '') + parts.join('/') || '.';
  };
  const basename = (p, ext) => { const name = p.replace(/\/+$/, '').split('/').pop(); return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name; };
  return {
    sep: '/', delimiter: ':', normalize, basename,
    resolve: (...parts) => normalize(parts.reduce((base, part) => String(part).startsWith('/') ? String(part) : base + '/' + part, cwd)),
    join: (...parts) => normalize(parts.filter(Boolean).join('/')),
    dirname: p => { const at = p.replace(/\/+$/, '').lastIndexOf('/'); return at < 0 ? '.' : at === 0 ? '/' : p.slice(0, at); },
    extname: p => { const name = basename(p), at = name.lastIndexOf('.'); return at > 0 ? name.slice(at) : ''; },
  };
}

// A file system in memory. `files` maps an absolute path to text or bytes; folders exist once something is in them.
function makeFs(path, files) {
  // What readFileSync returns without an encoding: the file's bytes (not a copy), which also answer
  // toString('base64') like a Buffer. Stored bytes are never changed in place, so sharing them is safe and a
  // large video costs nothing to pass around.
  class Bytes extends Uint8Array {
    toString(encoding) {
      if (encoding !== 'base64') return new TextDecoder().decode(this);
      let binary = '';
      for (let i = 0; i < this.length; i += 0x8000) binary += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
      return btoa(binary);
    }
  }
  const dirs = new Set(['/']);
  const missing = (call, p) => Object.assign(new Error(`ENOENT: no such file or directory, ${call} '${p}'`), { code: 'ENOENT' });
  const addDirs = p => { for (let dir = path.dirname(p); !dirs.has(dir); dir = path.dirname(dir)) dirs.add(dir); };
  for (const p of files.keys()) addDirs(p);
  const self = {
    existsSync: p => files.has(path.resolve(p)) || dirs.has(path.resolve(p)),
    statSync(p) {
      p = path.resolve(p);
      if (!self.existsSync(p)) throw missing('stat', p);
      return { isFile: () => files.has(p), isDirectory: () => dirs.has(p) };
    },
    readFileSync(p, encoding) {
      p = path.resolve(p);
      if (!files.has(p)) throw missing('open', p);
      const data = files.get(p);
      if (encoding) return typeof data === 'string' ? data : new TextDecoder().decode(data);
      return typeof data === 'string' ? new Bytes(new TextEncoder().encode(data)) : new Bytes(data.buffer, data.byteOffset, data.byteLength);
    },
    writeFileSync(p, data) { p = path.resolve(p); addDirs(p); files.set(p, typeof data === 'string' || ArrayBuffer.isView(data) ? data : new Uint8Array(data)); },
    copyFileSync(from, to) { self.writeFileSync(to, self.readFileSync(from)); },
    mkdirSync(p) { addDirs(path.resolve(p) + '/.'); },
    readdirSync(p, options = {}) {
      p = path.resolve(p);
      if (!dirs.has(p)) throw missing('scandir', p);
      const prefix = p === '/' ? '/' : p + '/', names = new Set();
      for (const entry of [...files.keys(), ...dirs]) {
        if (entry.startsWith(prefix) && entry.length > prefix.length) names.add(options.recursive ? entry.slice(prefix.length) : entry.slice(prefix.length).split('/')[0]);
      }
      return [...names].sort().map(name => options.withFileTypes ? { name, isFile: () => files.has(prefix + name), isDirectory: () => dirs.has(prefix + name) } : name);
    },
    rmSync(p) {
      p = path.resolve(p);
      for (const store of [files, dirs]) for (const entry of [...store.keys()]) if (entry === p || entry.startsWith(p + '/')) store.delete(entry);
    },
  };
  return self;
}

// sha256 of a string, as hex. The compiler uses it to name copied assets.
function sha256(text) {
  const K = [], H = [], fraction = x => ((x - Math.floor(x)) * 0x100000000) | 0;
  for (let n = 2; K.length < 64; n++) {
    let prime = true;
    for (let f = 2; f * f <= n; f++) if (n % f === 0) prime = false;
    if (prime) { if (H.length < 8) H.push(fraction(Math.sqrt(n))); K.push(fraction(Math.cbrt(n))); }
  }
  const bytes = [...new TextEncoder().encode(text)], bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, bits >>> 24, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);   // the length, as 64 bits
  const rotate = (x, n) => (x >>> n) | (x << (32 - n)), w = [];
  for (let at = 0; at < bytes.length; at += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[at + 4 * i] << 24) | (bytes[at + 4 * i + 1] << 16) | (bytes[at + 4 * i + 2] << 8) | bytes[at + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => { H[i] = (H[i] + value) | 0; });
  }
  return H.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

// child_process. The compiler runs ffprobe to learn how long a looping video is: the page measures the file
// itself and leaves the answer in `lengths` (path -> seconds). Nothing else can be run in a browser.
function makeChildProcess(lengths) {
  const run = (command, args) => {
    const seconds = command === 'ffprobe' && lengths.get(args[args.length - 1]);
    if (seconds) return { status: 0, stdout: `${seconds}\n`, stderr: '' };
    throw new Error(command === 'ffprobe' ? 'the length of this video is not known in the browser. Write it next to loop=on, for example length=4'
      : `this step runs a local program (${command}), which is not available in the browser`);
  };
  return { spawnSync: run, spawn: run, execSync: run };
}

// The tiny require: modules are functions keyed by path, loaded once.
function makeRequire(modules, builtins, path, process) {
  const loaded = {};
  return function load(file) {
    if (loaded[file]) return loaded[file].exports;
    const module = loaded[file] = { exports: {} }, dir = path.dirname(file);
    modules[file](module, module.exports, name => {
      if (builtins[name]) return builtins[name];
      const target = path.resolve(dir, name.replace(/\.js$/, '') + '.js');
      if (!modules[target]) throw new Error(`'${name}' is not available in the browser`);
      return load(target);
    }, dir, file, process);
    return module.exports;
  };
}

// What the page calls. build() takes either kind of Orb file and returns one playable HTML page.
function makeApi(load, fs, samples, lengths) {
  const prism = load('/orb/src/prism.js'), hf = load('/orb/src/hf.js'), web = load('/orb/src/web.js'), lang = load('/orb/src/lang.js');
  const WORK = '/work', OUT = '/out';   // WORK is the folder a source file "lives" in; write files there to use them
  const NO_FILES = /(?:asset|image|audio|voice|data file|composition|module) '(?!https?:)[^']*' not found/;
  // The same error, with a plain reason when the cause is something a browser page does not have.
  function explain(error) {
    const message = String(error.message);
    if (message.includes('three.min.js')) error.message = '3D elements (orb, world) are not available in the playground yet. Build this file with the orb command.';
    else if (/icon '[^']*' not found/.test(message)) error.message = message.replace(/\. (?:Closest|Icon folder)[\s\S]*$/, '') + '. Icons are not bundled in the playground. Build this file with the orb command.';
    else if (NO_FILES.test(message)) error.message = message.replace(/[;(] ?(?:searched:|looked in)[\s\S]*$/, '').trim() + '. The playground only has the files you add: click the file name under the editor, or use an https URL.';
    return error;
  }
  // The player compiler names an embedded picture's type after its extension. A file replaced under its old name
  // can be another type, so the type is read again from the first bytes.
  const retype = html => html.replace(/data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]{24})/g, (all, type, head) => {
    const real = web.mime('', Uint8Array.from(atob(head), c => c.charCodeAt(0)));
    return `data:${real.startsWith('image/') ? real : type};base64,${head}`;
  });
  function make(source, media) {
    try {
      if (web.isPlayer('', source)) {
        const motion = prism.parse(source, { baseDir: WORK });
        return { kind: 'player', html: retype(prism.compile(source, { baseDir: WORK })), warnings: [], media: {}, width: motion.w, height: motion.h, duration: motion.dur, present: !!motion.present };
      }
      const warnings = [];
      fs.rmSync(OUT);
      const { html, files, motion } = web.build(source, { workDir: OUT, baseDir: WORK, media, onWarning: message => warnings.push(message) });
      const waiting = media === false ? [...new Set([...html.matchAll(/data-orb-src="([^"]+)"/g)].map(m => m[1]))] : [];
      return { kind: 'video', html, warnings, media: Object.fromEntries(waiting.map(name => [name, { bytes: files[name], type: web.mime(name, files[name]) }])),
        width: motion.width, height: motion.height, duration: motion.duration, present: false,
        map: JSON.parse(fs.readFileSync(OUT + '/orb-map.json', 'utf8')) };   // item id -> source line, and each item's box
    } catch (error) { throw explain(error); }
  }
  return {
    samples,
    fonts: Object.keys(web.WEB_FONTS),   // the named families a video page can load
    fs,        // the in-memory file system: a file written under /work can be used by a source
    lengths,   // video path -> seconds. Filled by the page from the file itself; read when a looping video is built
    isPlayer: source => web.isPlayer('', source),
    // One self-contained page: what Export saves and what the command line writes.
    build: source => make(source),
    // The same page for a preview: pictures, video and audio are left out of the HTML and listed in `media`
    // ({ name: { bytes, type } }), for the page to hand over as object URLs.
    preview: source => make(source, false),
    // Read a source without building it: throws what build() would throw for a word, an option or a value the
    // compiler does not take. Cheap enough to ask "would this option be accepted here?".
    check(source) {
      try { if (web.isPlayer('', source)) prism.parse(source, { baseDir: WORK }); else hf.parse(source, { baseDir: WORK }); }
      catch (error) { throw explain(error); }
    },
    // The file after `orb expand`: every def, repeat, if and import written out.
    expand(source) {
      try { return (web.isPlayer('', source) ? lang.expand(source, { dialect: 'player', baseDir: WORK }) : hf.expandSource(source, { baseDir: WORK })).text; }
      catch (error) { throw explain(error); }
    },
  };
}

// ---------- the bundle ----------
// Follow require('./x') from the entry files.
function discover() {
  const found = new Map(), queue = [...ENTRIES];
  while (queue.length) {
    const file = queue.shift();
    if (found.has(file) || NODE_ONLY.includes(file)) continue;
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${file} is required by the compiler but does not exist; add it to NODE_ONLY if the browser never needs it`);
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^#!.*\n/, '');
    found.set(file, source);
    for (const m of source.matchAll(/require\('(\.[^']+)'\)/g)) queue.push(path.posix.join(path.posix.dirname(file), m[1].replace(/\.js$/, '') + '.js'));
  }
  return found;
}
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}

function bundle() {
  const text = {}, binary = {};
  for (const file of [...TEXT_FILES, ...walk('std').filter(f => f.endsWith('.orb'))].sort()) text['/orb/' + file] = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const file of walk('assets/sfx').filter(f => f.endsWith('.wav')).sort()) binary['/orb/' + file] = fs.readFileSync(path.join(ROOT, file)).toString('base64');
  const work = Object.fromEntries(SAMPLE_FILES.map(file => ['/work/' + path.basename(file), fs.readFileSync(path.join(ROOT, file), 'utf8')]));
  const samples = SAMPLES.map(([name, file]) => {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8').trimEnd(), lines = countLines(source), claimed = name.match(/^(\d+) lines:/);
    if (claimed && Number(claimed[1]) !== lines) throw new Error(`sample "${name}" has ${lines} lines (${file})`);
    return { title: claimed ? name : `${name} (${lines} lines)`, lines, source };
  });
  const modules = [...discover()].sort(([a], [b]) => a < b ? -1 : 1)
    .map(([file, source]) => `${JSON.stringify('/orb/' + file)}: function (module, exports, require, __dirname, __filename, process) {\n${source}\n}`);
  return `// Generated by scripts/build-playground.js from src/, std/ and assets/sfx. Do not edit: run the script again.
var Orb = (function () {
${makePath}
${makeFs}
${sha256}
${makeChildProcess}
${makeRequire}
${makeApi}
const TEXT = ${JSON.stringify(text)};
const BINARY = ${JSON.stringify(binary)};
const WORK = ${JSON.stringify(work)};
const SAMPLES = ${JSON.stringify(samples)};
const MODULES = {
${modules.join(',\n')}
};
const files = new Map(Object.entries(TEXT));
for (const [name, base64] of Object.entries(BINARY)) files.set(name, Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
for (const [name, text] of Object.entries(WORK)) files.set(name, new TextEncoder().encode(text));
const process = { env: {}, argv: [], cwd: () => '/work', exit() {} };
const path = makePath(process.cwd()), fs = makeFs(path, files);
fs.mkdirSync('/work');
const lengths = new Map();
const builtins = {
  fs, path,
  crypto: { createHash() { let data = ''; return { update(part) { data += part; return this; }, digest: () => sha256(data) }; } },
  child_process: makeChildProcess(lengths),
};
return makeApi(makeRequire(MODULES, builtins, path, process), fs, SAMPLES, lengths);
})();
if (typeof module === 'object' && module.exports) module.exports = Orb;
`;
}

module.exports = { bundle, makePath, makeFs, sha256 };

if (require.main === module) {
  const out = path.join(ROOT, 'playground', 'orb-compiler.js'), code = bundle();
  fs.writeFileSync(out, code);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(code.length / 1024).toFixed(0)} KB, ${discover().size} modules)`);
}
