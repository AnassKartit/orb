const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { expand } = require('../src/lang');
const { build } = require('../src/hf');

const tmp = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-lang-')); for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(d, f), s); return d; };

test('named parameters, defaults and positional values mix', () => {
  const src = 'def tag(copy, at, dur=2, color=#fff)\n  text "{copy}" at={at} dur={dur} color={color}\ntag "A" 1\ntag "B" at=3 color=#f00\ntag copy="C" at=4 dur=1';
  assert.deepEqual(expand(src).text.split('\n'), ['text "A" at=1 dur=2 color=#fff', 'text "B" at=3 dur=2 color=#f00', 'text "C" at=4 dur=1 color=#fff']);
});
test('a default may use an earlier parameter', () => {
  assert.equal(expand('def box(w, h={w/2})\n  rect box=0,0,{w},{h}\nbox 400').text, 'rect box=0,0,400,200');
});
test('call errors name the parameter and print the signature', () => {
  assert.throws(() => expand('def tag(copy, at, dur=2)\n  text "{copy}"\ntag copy="A"'), /tag needs 'at'; signature: tag\(copy, at, dur=2\)/);
  assert.throws(() => expand('def tag(copy)\n  text "{copy}"\ntag "A" copy="B"'), /'copy' is given twice/);
  assert.throws(() => expand('def tag(a=1, b)\n  text "x"'), /follows one that does/);
});
test('name=value that is not a parameter stays a positional value', () => {
  assert.equal(expand('def opt(o)\n  text "x" {o}\nopt in=pop').text, 'text "x" in=pop');
});
test('slot receives the caller children, named slots receive their block', () => {
  const src = 'def card(title)\n  group\n    text "{title}"\n    slot\n    slot footer\ncard "Cost"\n  text "$22"\n  footer\n    text "one job"';
  assert.deepEqual(expand(src).text.split('\n'), ['group', '  text "Cost"', '  text "$22"', '  text "one job"']);
});
test('children on a def without a slot are an error, not silently dropped', () => {
  assert.throws(() => expand('def a(x)\n  text "{x}"\na 1\n  shake'), /takes no indented children; add a 'slot' line/);
});
test('slot children see the caller scope, not the component scope', () => {
  assert.equal(expand('def wrap(x)\n  group\n    slot\nlet x = 7\nwrap 1\n  text "{x}"').text, 'group\n  text "7"');
});
test('import brings defs and lets; as gives a namespace; from picks names', () => {
  const dir = tmp({ 'brand.orb': 'let ink = #FFE600\ndef chip(copy)\n  text "{copy}" color={ink}\nmotion "ignored" 16:9 2s\n  rect at=0\n' });
  assert.equal(expand('import "./brand.orb"\nchip "A"', { baseDir: dir }).text, 'text "A" color=#FFE600');
  assert.equal(expand('import "brand" as b\nb.chip "A"\ntext "{b.ink}"', { baseDir: dir }).text, 'text "A" color=#FFE600\ntext "#FFE600"');
  assert.equal(expand('from "brand.orb" import chip\nchip "A"', { baseDir: dir }).text, 'text "A" color=#FFE600');
  assert.throws(() => expand('from "brand.orb" import nope', { baseDir: dir }), /'nope' is not defined in 'brand.orb'; it has: chip, /);
  assert.throws(() => expand('import "brand" as b\nb.chop "A"', { baseDir: dir }), /did you mean 'b.chip'/);
});
test('module components call their own helpers and report the call line', () => {
  const dir = tmp({ 'm.orb': 'def inner(c)\n  text "{c}"\ndef outer(c)\n  inner "{c}!"\n' });
  const out = expand('import "m" as m\n\nm.outer "hi"', { baseDir: dir });
  assert.equal(out.text, 'text "hi!"'); assert.deepEqual(out.map, [3]);
});
test('import cycles and missing modules are clear errors', () => {
  const dir = tmp({ 'a.orb': 'import "./b.orb"\n', 'b.orb': 'import "./a.orb"\n' });
  assert.throws(() => expand('import "./a.orb"', { baseDir: dir }), /import cycle: a\.orb -> b\.orb -> a\.orb/);
  assert.throws(() => expand('import "orb:std/nope"', { baseDir: dir }), /module 'orb:std\/nope' not found.*standard modules: .*orb:std\/short/);
});
test('canvas size is available as W and H', () => {
  assert.equal(expand('motion "x" 9:16 2s\n  rect box=0,0,{W},{H/2}').text, 'motion "x" 9:16 2s\n  rect box=0,0,1080,960');
  assert.equal(expand('motion "x" 640x360 2s\n  scene 2s\n    title "{W}"', { dialect: 'player' }).text.split('\n')[2].trim(), 'title "640"');
});
test('module styles are hoisted under the motion line and the standard library builds', () => {
  const dir = tmp({ 'look.orb': 'style big = size=140 color=#fff\n' });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-out-'));
  const m = build('import "./look.orb"\nimport "orb:std/short" as s\nmotion "t" 9:16 3s\n  s.backdrop\n  text "HI" at=0 style=big box=100,100,800,200\n  s.caption "ONE TWO" at=.5 dur=1 times="0,.3"\n    shake at=.1 dur=.2\n', out, { baseDir: dir });
  assert.equal(m.children.length, 3);
  assert.equal(m.children[2].animations.map(a => a.kind).join(), 'pop,karaoke,shake');
});
test('auto-fit can never shrink text below 60% of its authored size', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/hf-text.js'), 'utf8');
  assert.match(source, /const floor=max\*\.6;/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-out-'));
  build('motion "t" 16:9 2s\n  text "HELLO" at=0 box=100,100,400,60 size=120 stroke="14px #000" shadow="0 0 40px #0ff"\n', out, { baseDir: '.' });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /data-orb-fit="120"/); assert.doesNotMatch(html, /data-orb-inset/);
  assert.match(html, /padding:0px/);
});

test('typed expressions: lists, indexing, fields of an indexed row, conditions and list functions', () => {
  const { evaluate } = require('../src/lang');
  const env = { xs: [12, 18, 30], rows: [{ at: '2.5', name: 'a' }, { at: 4, name: 'b' }], i: 0 };
  assert.equal(evaluate('rows[i+1].at - rows[i].at', env, 1), 1.5);
  assert.equal(evaluate("rows[-1].name == 'b' ? max(xs) : 0", env, 1), 30);
  assert.equal(evaluate('xs[argmax(xs)] / len(xs)', env, 1), 10);
  assert.deepEqual(evaluate('range(1, 4)', env, 1), [1, 2, 3]);
  assert.throws(() => evaluate('rows[0].nope', env, 1), /no field 'nope'/);
  assert.throws(() => evaluate('xs[5]', env, 1), /index 5 is outside 0\.\.2/);
});

test('comments: a hex colour after = is a value, and a comment may still follow it', () => {
  assert.equal(expand('let ink = #FFE600   # brand yellow\ntext "x" color={ink}  # note').text, 'text "x" color=#FFE600');
  assert.equal(expand('let a = 3 # three\n# whole line\ntext "{a}"').text, 'text "3"');
});
