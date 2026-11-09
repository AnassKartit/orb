// Web target: structure of the page that `orb build --target web` writes. No browser needed here; what the page
// looks like when it plays is measured by scripts/web-parity.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const web = require('../src/web');

const ROOT = path.join(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-web-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseDir = path.join(root, 'source');
  fs.mkdirSync(baseDir);
  return { root, baseDir };
}
// Inline scripts that run as JavaScript, in page order.
const scripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// References a page would have to fetch from next to it.
const relative = html => [...html.matchAll(/(?<![\w-])(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^)"'\s]+)/g)].map(m => m[1] || m[2]).filter(ref => !/^(?:https:|data:|#)/.test(ref));
const NESTED = 'motion "Nested" 1080x600 3s\n  group id=outer at=0 box=200,100,680,400\n    rect at=0 color=#334155\n    group id=inner at=0.3 dur=2.7 box=80,80,500,220\n      text "Relative" at=0 box=20,50,460,120\n        pop at=0 dur=0.5\n  text "Top" at=1 dur=1 box=0,0,400,90\n';

test('one page: every composition is inlined as a template and nothing is left to fetch', t => {
  const { html, files } = web.build(NESTED, fixture(t));
  const compositions = Object.keys(files).filter(name => name.startsWith('compositions/'));
  assert.deepEqual(compositions.sort(), ['compositions/inner.html', 'compositions/outer.html']);
  const templates = [...html.matchAll(/<template data-orb-composition="([^"]+)">([\s\S]*?)<\/template>/g)];
  assert.deepEqual(templates.map(m => m[1]).sort(), compositions.sort());
  for (const [, , markup] of templates) assert.doesNotMatch(markup, /<script|<style/, 'templates hold markup only');
  // Every host still names its composition and keeps its own time span, which the runtime reads.
  const hosts = [...html.matchAll(/<div[^>]*data-composition-src="([^"]+)"[^>]*>/g)];
  assert.deepEqual(hosts.map(m => m[1]).sort(), compositions.sort());
  assert.match(hosts.find(m => m[1] === 'compositions/inner.html')[0], /data-start="0.3" data-duration="2.7"/);
  assert.deepEqual(relative(html), []);
  assert.equal((html.match(/<html/g) || []).length, 1);
});

test('each composition script gets its own function scope and runs after the runtime', t => {
  const { html } = web.build(NESTED, fixture(t));
  const all = scripts(html), registered = all.filter(code => code.startsWith('__orb.composition('));
  assert.deepEqual(registered.map(code => code.match(/^__orb\.composition\("([^"]+)",function\(\)\{/)[1]).sort(), ['inner', 'outer']);
  for (const code of registered) assert.match(code, /const tl=gsap\.timeline[\s\S]*window\.__timelines\["(?:inner|outer)"\]=tl;\s*\}\);$/);
  // Only the main script declares `tl` at the top level, so the whole page compiles as one program.
  assert.doesNotThrow(() => new vm.Script(all.join('\n;\n')));
  assert.throws(() => new vm.Script('const tl=1;\nconst tl=2;'), /already been declared/);
  // Order in the page: runtime (mounts the templates), main script, composition functions.
  const runtime = html.indexOf('window.__orb = {'), main = html.indexOf('window.__timelines["main"]=tl'), first = html.indexOf('__orb.composition(');
  assert.ok(runtime > 0 && runtime < main && main < first);
  assert.ok(html.lastIndexOf('</template>') < runtime, 'templates come before the runtime that mounts them');
});

test('local assets are embedded, each media file once; https passes through', t => {
  const f = fixture(t);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), wav = Buffer.from('RIFF$\0\0\0WAVEfmt '), font = Buffer.from('wOF2 not a real font');
  fs.writeFileSync(path.join(f.baseDir, 'a.png'), png);
  fs.writeFileSync(path.join(f.baseDir, 'tone.wav'), wav);
  fs.writeFileSync(path.join(f.baseDir, 'brand.woff2'), font);
  const source = 'motion "Assets" 640x360 2s\n  font "brand.woff2" as Brand\n  image "a.png" dur=2\n  image "a.png" at=0 dur=1 box=0,0,100,100\n  image "https://example.com/remote.png" at=0 dur=1 box=0,0,50,50\n  audio "tone.wav" at=0 dur=1\n  text "Hi" font=Brand at=0 dur=2 box=0,0,300,90\n';
  const { html, files } = web.build(source, f);
  const name = Object.keys(files).find(n => n.endsWith('-a.png'));
  // Two elements play the picture; its bytes are in the page once, in the table the runtime reads.
  assert.equal(html.split(`data-orb-src="${name}"`).length - 1, 2);
  assert.equal(html.split(png.toString('base64')).length - 1, 1);
  const table = JSON.parse(html.match(/<script type="application\/json" id="orb-assets">([\s\S]*?)<\/script>/)[1]);
  assert.equal(table[name], 'data:image/png;base64,' + png.toString('base64'));
  assert.ok(Object.values(table).includes('data:audio/wav;base64,' + wav.toString('base64')));
  // The font is used from CSS, so its data URL sits in the @font-face rule, once for the whole page.
  assert.equal(html.split('data:font/woff2;base64,' + font.toString('base64')).length - 1, 1);
  assert.match(html, /@font-face\{font-family:"Brand";src:url\("data:font\/woff2;base64,/);
  assert.match(html, /src="https:\/\/example\.com\/remote\.png"/);
  assert.deepEqual(relative(html), []);
  assert.equal(html.replace(/data-orb-src="assets\/[^"]+"/g, '').replace(/"assets\/[^"]+":"data:/g, '').includes('assets/'), false, 'no other mention of the assets folder');

  // For a folder, the same page keeps plain relative paths and no table.
  const folder = web.page(files, { embed: false });
  assert.ok(folder.includes(`src="${name}"`) && !folder.includes('id="orb-assets"') && !folder.includes(png.toString('base64')));
});

test('composition CSS stays inside its host; "#root" is the composition\'s own root', t => {
  const globals = new Set();
  const scoped = web.scopeCss('/* note */ #root{color:red} .x > b{top:0} @font-face{font-family:"F";src:url("f.woff2")} @keyframes k{from{opacity:0}to{opacity:1}} @media (min-width:1px){#root .y{left:0}}', 'card', globals);
  assert.equal(scoped, '[data-composition-id="card"]{&>[data-orb-root]{color:red}.x > b{top:0}@media (min-width:1px){&>[data-orb-root] .y{left:0}}}');
  assert.deepEqual([...globals], ['@font-face{font-family:"F";src:url("f.woff2")}', '@keyframes k{from{opacity:0}to{opacity:1}}']);
  assert.equal(web.scopeCss('a{content:"}{;"}', 'c', new Set()), '[data-composition-id="c"]{a{content:"}{;"}}');

  const source = 'motion "Raw" 640x360 2s\n  html id=custom dur=2\n    <style>#root{position:absolute;inset:0;background:#123456}#custom-copy{color:#fff}</style>\n    <div id="root" data-composition-id="custom"><p id="custom-copy">Raw</p></div>\n    <script>const tl=gsap.timeline({paused:true});tl.fromTo("#root p",{opacity:0},{opacity:1,duration:.2},0);window.__timelines["custom"]=tl;</script>\n';
  const { html } = web.build(source, fixture(t));
  assert.ok(html.includes('[data-composition-id="custom"]{&>[data-orb-root]{position:absolute;inset:0;background:#123456}#custom-copy{color:#fff}}'));
  assert.ok(html.includes('tl.fromTo("[data-composition-id=custom]>[data-orb-root] p"'), 'a script that names #root gets its own root');
  assert.doesNotThrow(() => new vm.Script(scripts(html).join('\n;\n')));
  assert.equal((html.match(/#root\{/g) || []).length, 2, 'only the main stage is styled as #root (by the compiler and by the runtime)');
});

test('named web fonts get faces for the weights that exist; declared families are left alone', t => {
  const inter = web.webFonts('<p style="font-family:Inter;font-weight:700">x</p>');
  assert.equal((inter.match(/@font-face/g) || []).length, 9);
  assert.match(inter, /font-family:"Inter";font-weight:700;font-display:block;src:url\("https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/inter@5\/files\/inter-latin-700-normal\.woff2"\)/);
  assert.match(web.webFonts('p{font:700 54px Space Mono}'), /space-mono-latin-400-normal[\s\S]*space-mono-latin-700-normal/);
  assert.equal(web.webFonts('@font-face{font-family:"Inter";src:url(x)} p{font-family:Inter}'), '');
  assert.equal(web.webFonts('p{font-family:Georgia}'), '');
  // The compiler's default family is Inter, so an ordinary page asks for it.
  assert.match(web.build('motion "T" 640x360 1s\n  text "Hi" dur=1', fixture(t)).html, /inter-latin-700-normal\.woff2/);
});

test('page() takes a file map, in memory, with text or bytes', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.baseDir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const { html, files } = web.build('motion "Map" 640x360 1s\n  group dur=1\n    image "pic.svg" dur=1', f);
  const name = Object.keys(files).find(n => n.endsWith('-pic.svg'));
  assert.equal(web.page(files), html);
  assert.equal(web.page({ ...files, [name]: new Uint8Array(files[name]) }), html, 'bytes need not be a Buffer');
  assert.match(web.page({ ...files, [name]: '<svg xmlns="http://www.w3.org/2000/svg"/>' }), /data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.throws(() => web.page({ 'index.html': '<html><body>plain</body></html>' }), /not an Orb video build/);
  assert.equal(web.isPlayer('a.orb', 'motion "A" 2s\n  scene 2s\n    title "x"'), true);
  assert.equal(web.isPlayer('a.orb', 'motion "A" 2s\n  text "scene" dur=2'), false);
});

test('a file\'s type comes from its bytes, then from its name', () => {
  const type = (name, hex) => web.mime(name, hex === undefined ? undefined : Buffer.from(hex, 'hex'));
  assert.equal(type('photo.svg', '89504e470d0a1a0a0000000d'), 'image/png');   // replaced under an old name
  assert.equal(type('a.png', 'ffd8ffe000104a464946'), 'image/jpeg');
  assert.equal(type('a.bin', '52494646aaaaaaaa57454250'), 'image/webp');
  assert.equal(type('a.bin', '52494646aaaaaaaa57415645'), 'audio/wav');
  assert.equal(type('a.png', '000000206674797069736f6d'), 'video/mp4');
  assert.equal(type('a.mp4', '1a45dfa3'), 'video/webm');
  assert.equal(web.mime('a.png', '<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml');
  assert.equal(web.mime('a.png', Buffer.from('<?xml version="1.0"?><svg/>')), 'image/svg+xml');
  assert.equal(type('words.json', '5b7b7d5d'), 'application/json');
  assert.equal(type('brand.woff2'), 'font/woff2');
  assert.equal(type('mystery', '00010203'), 'application/octet-stream');
});

test('page() can leave media for the page that shows it', t => {
  const f = fixture(t), png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), font = Buffer.from('wOF2 not a real font');
  fs.writeFileSync(path.join(f.baseDir, 'a.png'), png);
  fs.writeFileSync(path.join(f.baseDir, 'brand.woff2'), font);
  const { files } = web.build('motion "M" 640x360 1s\n  font "brand.woff2" as Brand\n  image "a.png" dur=1\n  text "Hi" font=Brand at=0 dur=1 box=0,0,300,90\n', f);
  const html = web.page(files, { media: false }), name = Object.keys(files).find(n => n.endsWith('-a.png'));
  assert.ok(html.includes(`data-orb-src="${name}"`) && !html.includes(png.toString('base64')) && !html.includes('id="orb-assets"'));
  assert.ok(html.includes('data:font/woff2;base64,' + font.toString('base64')), 'what CSS refers to is still inside the page');
  // The runtime takes the URLs through __orb.media() and sets no source until then.
  const runtime = fs.readFileSync(path.join(ROOT, 'src/web-runtime.js'), 'utf8');
  assert.match(runtime, /media\(urls\) \{ Object\.assign\(assets, urls\); link\(document\); \}/);
  assert.match(runtime, /if \(assets\[el\.dataset\.orbSrc\]\) el\.src = /);
});

test('the runtime is plain browser JavaScript with the page API', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'src/web-runtime.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(runtime));
  assert.doesNotMatch(runtime, /\brequire\(|<\/script>/);
  assert.match(runtime, /Object\.assign\(window, \{ seek, play, pause, duration \}\)/);
  assert.match(runtime, /currentTime: \{ get: \(\) => time \}, paused: \{ get: \(\) => !playing \}/);
  assert.match(runtime, /query\.get\('controls'\) === '0'/);
});

test('command line: --target web writes one file, or a folder with assets', t => {
  const f = fixture(t), run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'src/prism.js'), ...args], { encoding: 'utf8' });
  const single = path.join(f.root, 'text.html');
  let r = run('build', path.join(ROOT, 'examples/hf/text.orb'), '--target', 'web', '-o', single);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote .*text\.html \([\d.]+ KB, plays in any browser\)/);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['source', 'text.html']);
  assert.match(fs.readFileSync(single, 'utf8'), /window\.__orb = \{/);

  const folder = path.join(f.root, 'image');
  r = run('build', path.join(ROOT, 'examples/hf/image.orb'), '--target', 'web', '-o', folder);
  assert.equal(r.status, 0, r.stderr);
  const asset = fs.readdirSync(path.join(folder, 'assets'));
  assert.equal(asset.length, 1);
  assert.ok(fs.readFileSync(path.join(folder, 'index.html'), 'utf8').includes(`src="assets/${asset[0]}"`));

  // A file with scenes is already one interactive page.
  const player = path.join(f.root, 'player.html');
  r = run('build', path.join(ROOT, 'benchmark/runs/b1/orb.prism'), '--target', 'web', '-o', player);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(player, 'utf8'), /window\.__PRISM__ = /);

  r = run('build', path.join(ROOT, 'examples/hf/text.orb'), '--target', 'pdf', '-o', single);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown target 'pdf'; available: web/);
});
