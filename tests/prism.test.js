const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { compile, parse, PrismError, LangError } = require('../src/prism');
const { expand, evaluate } = require('../src/lang');

const ex = (n) => fs.readFileSync(path.join(__dirname, '..', 'examples', n), 'utf8');

test('examples compile', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'examples')).filter(f => f.endsWith('.prism'))) {
    assert.ok(compile(ex(f)).includes('__PRISM__'), f);
  }
});

test('expressions', () => {
  assert.strictEqual(evaluate('1 + 2 * 3', {}, 1), 7);
  assert.strictEqual(evaluate('(1 + 2) * 3', {}, 1), 9);
  assert.strictEqual(evaluate('max(i, 5) - 1', { i: 3 }, 1), 4);
  assert.strictEqual(evaluate('i * 12', { i: 2 }, 1), 24);
  assert.throws(() => evaluate('nope + 1', {}, 4), /line 4: unknown name 'nope'/);
  assert.throws(() => evaluate('1 +', {}, 2), /expression ended early/);
  assert.throws(() => evaluate('process.exit()', {}, 2), LangError); // no eval, no escape hatch
});

test('let, def, repeat expand to plain text', () => {
  const src = [
    'motion "T" 6s',
    '  def kpi(label, value)',
    '    count "{label}" {value}',
    '  repeat 2 as i',
    '    scene 3s',
    '      kpi "Week {i}" {i * 12}',
  ].join('\n');
  const { text } = expand(src);
  assert.strictEqual(text, [
    'motion "T" 6s',
    '  scene 3s',
    '    count "Week 1" 12',
    '  scene 3s',
    '    count "Week 2" 24',
  ].join('\n'));
  assert.strictEqual(parse(src).scenes.length, 2);
});

test('if and let', () => {
  const src = 'let big = 1\nmotion "T" 3s\n  scene 3s\n    if big == 1\n      title "Yes"\n    if big == 2\n      title "No"';
  const m = parse(src);
  assert.strictEqual(m.scenes[0].els.length, 1);
  assert.strictEqual(m.scenes[0].els[0].text[0], 'Yes');
});

test('errors point at the original source line', () => {
  const src = 'motion "T" 3s\n  repeat 2 as i\n    scene 3s\n      titel "Hi {i}"';
  assert.throws(() => parse(src), (e) => e instanceof PrismError && /line 4: unknown element 'titel', did you mean 'title'\?/.test(e.message));
});

test('guards: recursion, wrong arity, runaway repeat', () => {
  assert.throws(() => expand('def a(x)\n  a {x}\na 1'), /calls itself/);
  assert.throws(() => expand('def a(x)\n  title "{x}"\na 1 2'), /takes 1 value/);
  assert.throws(() => expand('repeat 9999 as i\n  title "x"'), /between 0 and 500/);
});

test('validation messages', () => {
  assert.throws(() => parse('motion "T" 3s\n  scene 3s\n    bars 5'), /needs at least two numbers/);
  assert.throws(() => parse('motion "T" 3s\n  scene 3s\n    title'), /needs quoted text/);
  assert.throws(() => parse('title "x"'), /must start with 'motion'/);
  assert.throws(() => parse('motion "T" 3s\n  scene 3s\n    title "x" in=fde'), /did you mean 'fade'/);
});

test('scene timing', () => {
  const m = parse('motion "T"\n  scene 2s\n  scene 3s');
  assert.deepStrictEqual(m.scenes.map(s => [s.start, s.end]), [[0, 2], [2, 5]]);
  assert.strictEqual(m.dur, 5);
});

test('ease names, relative timing and stagger origin', () => {
  const m = parse('motion "T" 4s\n  scene 4s\n    title "A" dur=1\n    sub "B" at=+0.5 ease=spring\n    bars 1 2 3 ease=inOut(3) from=center at=<');
  const [a, b, c] = m.scenes[0].els.filter(e => ['title', 'sub', 'bars'].includes(e.type));
  assert.strictEqual(b.at, a.at + a.dur + 0.5);
  assert.strictEqual(c.at, b.at);
  assert.strictEqual(b.ease, 'spring');
  assert.strictEqual(c.ease, 'inOut(3)');
  assert.throws(() => parse('motion "T" 4s\n  scene 4s\n    bars 1 2 ease=sprng'), /did you mean 'spring'/);
  assert.throws(() => parse('motion "T" 4s\n  scene 4s\n    bars 1 2 from=middle'), /unknown stagger origin/);
});

test('bar highlight labels may not contradict the data', () => {
  const src = (attr) => `motion "T" 4s\n  scene 4s\n    bars 3 1 2 ${attr}`;
  assert.throws(() => parse(src('peak="LOWEST"')), /peak marks the HIGHEST bar.*use low=/);
  assert.throws(() => parse(src('low="BEST MONTH"')), /low marks the LOWEST bar.*use peak=/);
  assert.throws(() => parse(src('peak="A" low="B"')), /either peak= or low=/);
  assert.doesNotThrow(() => parse(src('low="LOWEST"')));
  assert.doesNotThrow(() => parse(src('peak="WORST MONTH"')));   // "worst" is context dependent, so it is allowed
});

test('icon= is a built-in glyph on cards but a file on diagram nodes', () => {
  assert.doesNotThrow(() => compile('motion "T" 4s\n  scene 4s\n    grid 2\n      card icon=shield-check "A"\n      card icon=gear "B"'));
  assert.throws(() => compile('motion "T" 4s\n  scene 4s\n    diagram\n      node a "A" icon=does-not-exist-xyz\n'), /icon 'does-not-exist-xyz' not found/);
});

test('every example compiles', () => {
  const fs = require('fs'), path = require('path');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.prism') ? [path.join(d, e.name)] : []);
  for (const f of walk(path.join(__dirname, '..', 'examples'))) assert.doesNotThrow(() => compile(fs.readFileSync(f, 'utf8'), { baseDir: path.dirname(f) }), f);
});

