// The browser bundle of the compiler (scripts/build-playground.js), run here in a bare JavaScript context: no
// require, no process, no Buffer, no file system. What the page around it does is covered by
// scripts/playground-smoke.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { bundle, makePath, sha256 } = require('../scripts/build-playground');
const web = require('../src/web');
const prism = require('../src/prism');

const ROOT = path.join(__dirname, '..');
const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob, console });
vm.runInContext(bundle(), context);
const Orb = context.Orb;

test('the bundle needs nothing from Node', () => {
  assert.equal(vm.runInContext('typeof require + typeof process + typeof Buffer + typeof module', context), 'undefinedundefinedundefinedundefined');
  assert.deepEqual(Object.keys(Orb).sort(), ['build', 'expand', 'fs', 'isPlayer', 'lengths', 'preview', 'samples']);
});

test('samples menu: the order asked for, and line counts that are true', () => {
  assert.deepEqual([...Orb.samples].map(s => s.title.replace(/\d+ lines\)/, 'N lines)')), [
    'Swap the image and the colours (N lines)', '3 lines: animated title', '5 lines: counter and bar chart', '12 lines: data video', '14 lines: interactive character, hover and click it',
    'Presentation (N lines)', 'Chart written in Orb (N lines)', 'Kinetic captions (N lines)']);
  for (const sample of Orb.samples) {
    assert.equal(Number(sample.title.match(/(\d+) lines/)[1]), sample.source.split('\n').filter(line => line.trim()).length, sample.title);
    assert.equal(sample.source, sample.source.trimEnd());
  }
  assert.match(Orb.samples[5].source, /present=on/);
  assert.equal((Orb.samples[5].source.match(/^ {2}scene /gm) || []).length, 6);
  // The first sample: one picture, and one accent colour written in three places.
  assert.equal(Orb.samples[0].source.split('#ff2d78').length - 1, 3);
  assert.equal(Orb.samples[0].source.split('placeholder.svg').length - 1, 1);
  assert.ok(Orb.fs.existsSync('/work/placeholder.svg'));
});

test('every sample builds to the page the command line builds', () => {
  const sources = { 3: 'benchmark/runs/b1/orb.prism', 4: 'examples/interactive/hoot.prism', 6: 'examples/std/charts-demo.orb', 7: 'examples/std/short-demo.orb' };
  for (const [i, sample] of Orb.samples.entries()) {
    const built = Orb.build(sample.source);
    assert.equal(built.kind, i >= 1 && i <= 5 ? 'player' : 'video', sample.title);
    assert.equal(built.present, i === 5, sample.title);
    assert.ok(built.duration > 0 && built.width > 0 && built.height > 0);
    assert.match(built.html, built.kind === 'player' ? /window\.__PRISM__ = / : /window\.__orb = \{/);
    if (!sources[i]) continue;
    const file = path.join(ROOT, sources[i]), baseDir = path.dirname(file);
    const expected = built.kind === 'player' ? prism.compile(sample.source, { baseDir }) : web.build(sample.source, { baseDir }).html;
    assert.equal(built.html, expected, `${sample.title}: same page as Node`);
  }
});

test('expand writes out imports and defs; errors keep their line', () => {
  const text = Orb.expand(Orb.samples[7].source);
  assert.match(text, /^motion "Std short demo"/m);
  assert.match(text, /^ {2}text "ONE FILE\./m);
  assert.doesNotMatch(text, /^\s*s\.\w+|^import/m);
  assert.equal(Orb.expand(Orb.samples[3].source), Orb.samples[3].source);
  assert.throws(() => Orb.build('motion "X" 2s\n  tect "Hi"'), e => e.line === 2 && /line 2: unknown word 'tect'; did you mean 'text'/.test(e.message));
  assert.throws(() => Orb.build('motion "X" 1280x720 2s\n  scene 2s\n    titel "Hi"'), e => e.line === 3 && /did you mean 'title'/.test(e.message));
});

test('what a browser page cannot do fails with a plain message', () => {
  assert.throws(() => Orb.build('motion "X" 1280x720 4s\n  scene 4s\n    orb color=blue'), /^Error: 3D elements \(orb, world\) are not available in the playground yet\./);
  assert.throws(() => Orb.build('motion "X" 1280x720 4s\n  scene 4s\n    diagram\n      node a "A" icon=firewalls\n      node b "B"\n      edge a -> b'),
    e => e.line === 4 && e.message === "line 4: icon 'firewalls' not found. Icons are not bundled in the playground. Build this file with the orb command.");
  assert.throws(() => Orb.build('motion "X" 2s\n  image "photo.png"'), e => e.message === "line 2: asset 'photo.png' not found. The playground only has the files you add: click the file name under the editor, or use an https URL.");
  assert.throws(() => Orb.build('motion "X" 1280x720 2s\n  scene 2s\n    image image=photo.png'), /^Error: line 3: image 'photo\.png' not found\. The playground only has the files you add/);
  assert.throws(() => Orb.build('import "./brand.orb"\nmotion "X" 2s\n  text "a"'), /module '\.\/brand\.orb' not found.*The playground only has the files you add/);
});

test('files written to the in-memory folder are used: an added image ends up in the page as a data URL', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 250]), url = 'data:image/png;base64,' + Buffer.from(png).toString('base64');
  Orb.fs.writeFileSync('/work/my-photo.png', png);
  const video = Orb.build('motion "V" 640x360 2s\n  image "my-photo.png" at=0 box=200,200,600,400');
  assert.equal(video.html.split(url).length - 1, 1);
  const player = Orb.build('motion "P" 1280x720 2s\n  scene 2s\n    image image=my-photo.png');
  assert.ok(player.html.includes(url));
  Orb.fs.writeFileSync('/work/brand.orb', 'def tag(copy)\n  text "{copy}" dur=1\n');
  assert.match(Orb.build('import "./brand.orb"\nmotion "M" 640x360 1s\n  tag "From a module"').html, /From a module|From<\/span>/);
  // The bundled sound effects are there too.
  assert.match(Orb.build('motion "S" 640x360 2s\n  sfx pop at=0\n  sfx pop at=1\n  text "Hi" dur=2').html, /data:audio\/wav;base64,/);
});

test('preview() leaves media out of the page and lists it; build() puts it in', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]), base64 = Buffer.from(bytes).toString('base64');
  Orb.fs.writeFileSync('/work/placeholder.svg', bytes);   // a png, replaced under the old name of the sample's picture
  const source = Orb.samples[0].source, preview = Orb.preview(source), [name] = Object.keys(preview.media);
  assert.match(name, /^assets\/\w+-placeholder\.svg$/);
  assert.ok(preview.html.includes(`data-orb-src="${name}"`) && !preview.html.includes(base64) && !preview.html.includes('id="orb-assets"'));
  assert.equal(preview.media[name].type, 'image/png', 'the type follows the bytes, not the old name');
  assert.equal(preview.media[name].bytes.buffer, bytes.buffer, 'the file is handed over as it is, not copied');
  assert.ok(Orb.build(source).html.includes(`"${name}":"data:image/png;base64,${base64}"`));
  assert.deepEqual(Object.keys(Orb.build(source).media), []);
  // The player compiler types an embedded picture by its extension; the bundle corrects it from the bytes.
  assert.ok(Orb.build('motion "P" 1280x720 2s\n  scene 2s\n    image image=placeholder.svg').html.includes(`data:image/png;base64,${base64}`));
  assert.deepEqual(Object.keys(Orb.preview(Orb.samples[1].source).media), []);
});

test('a looping video takes its length from the page, not from ffprobe', () => {
  Orb.fs.writeFileSync('/work/clip.mp4', new Uint8Array(8));
  assert.throws(() => Orb.build('motion "X" 4s\n  video "clip.mp4" loop=on'), /the length of this video is not known in the browser\. Write it next to loop=on, for example length=4/);
  assert.doesNotThrow(() => Orb.build('motion "X" 4s\n  video "clip.mp4" loop=on length=2'));
  Orb.lengths.set('/work/clip.mp4', 1.5);
  assert.equal((Orb.build('motion "X" 4s\n  video "clip.mp4" loop=on').html.match(/<video/g) || []).length, 3);
});

test('Learn Orb: every step starts from a file that compiles, and its change compiles and ticks it', () => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'playground', 'lessons.js'), 'utf8'), context);
  const lessons = [...context.ORB_LESSONS];
  assert.equal(lessons.length, 9);
  for (const [i, lesson] of lessons.entries()) {
    const label = `step ${i + 1}: ${lesson.title}`;
    assert.ok(lesson.title && lesson.say && lesson.source.split('\n').length <= 14, label);
    assert.doesNotThrow(() => Orb.build(lesson.source), label);
    assert.equal(lesson.done(lesson.source), false, `${label} is not done before the change`);
    const changed = lesson.show(lesson.source);
    assert.doesNotThrow(() => Orb.build(changed), label);
    assert.equal(lesson.done(changed), true, `${label} is done after Show me`);
    assert.equal(lesson.done(lesson.show(changed)), true, `${label}: Show me twice changes nothing more`);
  }
  assert.deepEqual(lessons.map(lesson => Orb.build(lesson.show(lesson.source)).kind), ['player', 'player', 'player', 'player', 'player', 'player', 'player', 'video', 'video']);
  assert.equal(Orb.build(lessons[5].show(lessons[5].source)).present, true, 'step 6 is a slideshow');
});

test('stand-ins: sha256 and path behave like Node', () => {
  for (const text of ['', 'abc', '/home/x/assets/photo.png', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(63), 'd'.repeat(64), 'e'.repeat(200), 'é → 日本'.repeat(40)]) {
    assert.equal(sha256(text), crypto.createHash('sha256').update(text).digest('hex'), `sha256 of ${text.length} characters`);
  }
  const mine = makePath('/work'), posix = path.posix;
  for (const args of [['/orb/src', '..', 'std'], ['a', '', 'b/../c'], ['/orb/src', 'template.html'], ['', 'projects', 'icons']]) assert.equal(mine.join(...args), posix.join(...args));
  for (const args of [['/out'], ['/work', 'assets', '../a.png'], ['/work', '/orb/std'], ['/a/b/../../c']]) assert.equal(mine.resolve(...args), posix.resolve(...args));
  assert.equal(mine.resolve('x/y.orb'), '/work/x/y.orb');
  for (const p of ['/a/b/c.html', 'c.html', '/a', '/a/b/', 'a/b.tar.gz', '/.hidden']) {
    assert.equal(mine.dirname(p), posix.dirname(p));
    assert.equal(mine.basename(p), posix.basename(p));
    assert.equal(mine.basename(p, '.html'), posix.basename(p, '.html'));
    assert.equal(mine.extname(p), posix.extname(p));
  }
});
