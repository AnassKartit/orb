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
const OrbEdit = require('../playground/edit');
const web = require('../src/web');
const prism = require('../src/prism');

const ROOT = path.join(__dirname, '..');
const context = vm.createContext({ TextEncoder, TextDecoder, btoa, atob, console });
vm.runInContext(bundle(), context);
const Orb = context.Orb;

test('the bundle needs nothing from Node', () => {
  assert.equal(vm.runInContext('typeof require + typeof process + typeof Buffer + typeof module', context), 'undefinedundefinedundefinedundefined');
  assert.deepEqual(Object.keys(Orb).sort(), ['build', 'check', 'expand', 'fonts', 'fs', 'isPlayer', 'lengths', 'preview', 'samples']);
});

test('samples menu: the order asked for, and line counts that are true', () => {
  assert.deepEqual([...Orb.samples].map(s => s.title.replace(/\d+ lines\)/, 'N lines)')), [
    'Swap the image and the colours (N lines)', '3 lines: animated title', '5 lines: counter and bar chart', '12 lines: data video', '14 lines: interactive character, hover and click it',
    'Presentation (N lines)', 'Chart written in Orb (N lines)', 'Kinetic captions (N lines)',
    'Make it yours: colours, fonts, tags, a framed picture (N lines)', 'Four characters, one rig (N lines)', 'Deck looks: backgrounds, transitions, builds (N lines)']);
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
  const sources = { 3: 'benchmark/runs/b1/orb.prism', 4: 'examples/interactive/hoot.prism', 6: 'examples/std/charts-demo.orb', 7: 'examples/std/short-demo.orb', 9: 'examples/cartoon/cast.orb' };
  for (const [i, sample] of Orb.samples.entries()) {
    const built = Orb.build(sample.source);
    assert.equal(built.kind, (i >= 1 && i <= 5) || i >= 8 ? 'player' : 'video', sample.title);
    assert.equal(built.present, i === 5 || i === 10, sample.title);
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

test('check() answers without building; preview() comes with the map from items to source lines', () => {
  assert.equal(Orb.check('motion "X" 2s\n  text "a" dur=2'), undefined);
  assert.throws(() => Orb.check('motion "X" 2s\n  text "a" colr=#fff'), e => e.line === 2 && /unknown option 'colr'; did you mean 'color'/.test(e.message));
  assert.throws(() => Orb.check('motion "X" 1280x720 2s\n  scene 2s\n    titel "a"'), /line 3: unknown element 'titel'/);
  assert.equal(Orb.fonts.length, 18);
  assert.ok(Orb.fonts.includes('Inter') && Orb.fonts.includes('Space Mono'));
  const page = Orb.preview(Orb.samples[0].source), picture = page.map.items.find(item => item.text === 'placeholder.svg');
  assert.equal(page.map.ids[picture.id], 3);
  assert.deepEqual([...picture.box], [110, 287, 884, 506]);
  assert.equal(Orb.preview(Orb.samples[1].source).map, undefined, 'a file with scenes has no boxes to move');
});

test('edit.js reads and rewrites one line', () => {
  const line = '  text "Swap the image<br>and the *colours*" at=.5 box=1090,350,720,240 size=92 color=#ffffff emph=#ff2d78 in=rise   # a note';
  assert.deepEqual(OrbEdit.parse(line).tokens.map(token => token.text), ['text', '"Swap the image<br>and the *colours*"', 'at=.5', 'box=1090,350,720,240', 'size=92', 'color=#ffffff', 'emph=#ff2d78', 'in=rise']);
  assert.equal(OrbEdit.parse(line).word, 'text');
  assert.equal(OrbEdit.get(line, 'box'), '1090,350,720,240');
  assert.equal(OrbEdit.get(line, 'radius'), undefined);
  assert.equal(OrbEdit.text(line), 'Swap the image<br>and the *colours*');
  assert.equal(OrbEdit.set(line, 'size', 120), line.replace('size=92', 'size=120'));
  assert.equal(OrbEdit.set(line, 'font', 'Space Mono'), line.replace('in=rise', 'in=rise font="Space Mono"'), 'a new option goes after the last one, before the comment');
  assert.equal(OrbEdit.remove(line, 'emph'), line.replace(' emph=#ff2d78', ''));
  assert.equal(OrbEdit.remove(line, 'radius'), line);
  assert.equal(OrbEdit.setText(line, 'Say "hi"'), line.replace('"Swap the image<br>and the *colours*"', '"Say \'hi\'"'));
  assert.equal(OrbEdit.set('    bars 1 2 3', 'colors', '#ff0000,#00ff00'), '    bars 1 2 3 colors=#ff0000,#00ff00');
  assert.equal(OrbEdit.get('    card icon=gear "A card" label="Two words"', 'label'), 'Two words');
  assert.deepEqual(OrbEdit.parse("  c.bars [12, 18] ['Mon', 'Tue'] at=0 badge='BEST DAY'").tokens.map(token => token.text), ['c.bars', '[12, 18]', "['Mon', 'Tue']", 'at=0', "badge='BEST DAY'"]);
  assert.equal(OrbEdit.parse('  rect color=#fff # backdrop').tokens.length, 2, 'a hex colour is a value, " #" starts a comment');
  // Every rewrite still compiles.
  for (const changed of [OrbEdit.set(line, 'size', 120), OrbEdit.set(line, 'font', 'Space Mono'), OrbEdit.remove(line, 'emph'), OrbEdit.setText(line, 'Say "hi"'), OrbEdit.set(line, 'box', '10,20,300,200')]) {
    assert.doesNotThrow(() => Orb.check(`motion "X" 16:9 4s\n${changed}`), changed);
  }
});

test('the panel table: every option offered for a video word is one the compiler takes', () => {
  const lines = { motion: '', text: '  text "a" dur=2', rect: '  rect dur=2', image: '  image "placeholder.svg" dur=2', video: '  video "clip.mp4" dur=2 length=2', audio: '  audio "pop" at=0', group: '  group dur=2\n    rect dur=1',
    to: '  rect dur=2\n    to x=1', pop: '  rect dur=2\n    pop', count: '  text "1" dur=2\n    count', pulse: '  rect dur=2\n    pulse', shake: '  rect dur=2\n    shake', wipe: '  rect dur=2\n    wipe', spin: '  rect dur=2\n    spin', punch: '  rect dur=2\n    punch' };
  const sample = spec => spec.probe || { colour: '#ff0000', box: '10,10,100,100' }[spec.kind] || (spec.kind === 'menu' ? spec.choices.find(Boolean) : spec.kind === 'words' ? spec.unset || '2px solid #fff' : String(spec.unset === '' ? Math.max(spec.min, 1) : spec.unset));
  Orb.fs.writeFileSync('/work/clip.mp4', new Uint8Array(8));
  let count = 0;
  for (const [word, body] of Object.entries(lines)) {
    const specs = OrbEdit.controls(word, false, [...Orb.fonts]);
    assert.ok(specs.length, `${word} has controls`);
    for (const spec of specs) {
      const rows = (word === 'motion' ? 'motion "X" 16:9 4s\n  rect dur=2' : `motion "X" 16:9 4s\n${body}`).split('\n'), at = word === 'motion' ? 0 : rows.length - 1;
      rows[at] = OrbEdit.set(rows[at], spec.name, sample(spec));
      assert.doesNotThrow(() => Orb.check(rows.join('\n')), `${word} ${spec.name}=${sample(spec)}`);
      count++;
    }
  }
  assert.ok(count > 90, `${count} options checked`);
  assert.deepEqual(OrbEdit.controls('text', false, ['Inter', 'Lato']).find(spec => spec.name === 'font').choices, ['Inter', 'Lato']);
  assert.deepEqual(OrbEdit.controls('s.caption', false), [], 'a word the table does not know gets no controls');
});

test('the panel table for files with scenes: a control only for what the word can take', () => {
  const names = word => OrbEdit.controls(word, true).map(spec => spec.name);
  for (const name of ['color', 'size', 'rotate', 'opacity', 'at', 'dur', 'in']) assert.ok(names('title').includes(name), `title ${name}`);
  for (const name of ['labels', 'peak', 'colors', 'bar', 'peak-color', 'label-color', 'value-color', 'tag']) assert.ok(names('bars').includes(name), `bars ${name}`);
  assert.ok(!names('mascot').includes('rotate') && names('mascot').includes('color') && names('mascot').includes('kind'), 'a drawn character takes only its own options');
  assert.ok(names('shape').includes('rotate') && names('line').includes('stroke') && names('scene').includes('valign'));
  // What docs/SPEC.md lists for every element and for charts is in the table, and the compiler takes it.
  for (const [line, options] of [['title "a"', 'color=#ffd166 font=serif weight=800 size=40 align=right spacing=.2em upper=on x=-40 y=24 w=320 h=200 rotate=-3 opacity=.6 bg=#00000055 pad=14 radius=12 border=#ffffff shadow=on'],
    ['bars 1 2 3', 'colors=#f66,#fc6,#6c9 label-color=#fff value-color=#fff label-size=18 value-size=24 values=off grid=on bar=#4cc9f0 peak-color=#fff low-color=#fff gap=28 tag=NEW tag-at=1'],
    ['line 1 2 3', 'stroke=#06d6a0 fill=off dots=off'], ['donut a=1 b=2', 'hole=.5']]) {
    const word = line.split(' ')[0];
    for (const option of options.split(' ')) {
      assert.ok(names(word).includes(option.split('=')[0]), `${word} ${option} is in the table`);
      assert.doesNotThrow(() => Orb.check(`motion "X" 1280x720 3s\n  scene 3s\n    ${line} ${option}`), `${word} ${option}`);
    }
  }
  assert.deepEqual(names('motion').slice(0, 3), ['accent', 'mode', 'font']);
  assert.deepEqual(OrbEdit.controls('title', true).find(spec => spec.name === 'font').choices, ['sans', 'serif', 'mono', 'rounded', 'display', 'condensed']);
  // Timing and the motion line are settled parts of the language: the compiler takes each of them today.
  for (const spec of [...OrbEdit.controls('motion', true), ...OrbEdit.controls('title', true).filter(each => ['at', 'dur', 'in', 'ease', 'stagger'].includes(each.name))]) {
    const value = spec.probe || (spec.kind === 'menu' ? spec.choices.find(Boolean) : spec.kind === 'colour' ? '#ff0000' : String(spec.unset === '' ? 1 : spec.unset));
    const rows = ['motion "X" 1280x720 3s', '  scene 3s', '    title "a"'], at = OrbEdit.controls('motion', true).includes(spec) ? 0 : 2;
    rows[at] = OrbEdit.set(rows[at], spec.name, value);
    if (spec.name === 'look') continue;   // look= and accent-free themes exclude each other; checked by the compiler's own tests
    assert.doesNotThrow(() => Orb.check(rows.join('\n')), `${rows[at]}`);
  }
});

test('the Add menu: every ready line compiles in its kind of file, and on an empty one', () => {
  assert.deepEqual(OrbEdit.ADD.map(entry => entry.title), ['Text', 'Title', 'Counter', 'Bar chart', 'Line chart', 'Image or video', 'Slide (a new scene)', 'Character', 'Shape']);
  for (const entry of OrbEdit.ADD) {
    for (const kind of ['scenes', 'video']) {
      if (!entry[kind]) continue;
      for (const [W, H] of [[1920, 1080], [1080, 1920], [640, 360]]) {
        const lines = entry[kind](W, H), start = kind === 'video' ? [`motion "Untitled" ${W}x${H} 6s`, '  rect at=0 color=#0b0f1a'] : OrbEdit.STARTER.scenes;
        const source = [...(kind === 'video' && entry.needs ? [entry.needs] : []), ...(entry.block ? [start[0], ...lines.map(line => '  ' + line)] : [...start, ...lines.map(line => (kind === 'scenes' ? '    ' : '  ') + line)])].join('\n');
        assert.doesNotThrow(() => Orb.build(source), `${entry.title} in a ${kind === 'scenes' ? 'file with scenes' : `${W}x${H} video file`}`);
      }
    }
  }
  assert.equal(OrbEdit.ADD.find(entry => entry.file).title, 'Image or video');
  assert.doesNotThrow(() => Orb.build(OrbEdit.STARTER.video.join('\n')));
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
