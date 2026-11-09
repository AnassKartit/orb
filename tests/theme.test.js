const test = require('node:test');
const assert = require('node:assert');
const { makeTheme } = require('../src/theme');

const hsl = (hh) => { const a = (hh % 360) / 60, x = 1 - Math.abs(a % 2 - 1), t = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(a)]; return '#' + t.map(v => Math.round((0.15 + 0.7 * v) * 255).toString(16).padStart(2, '0')).join(''); };

test('palette synthesis: every hue passes its own checks in both modes', () => {
  for (const mode of ['dark', 'light']) {
    const fails = [];
    for (let h = 0; h < 360; h += 10) { const r = makeTheme(hsl(h), mode).report; if (!r.ok) fails.push(`${mode} hue ${h}: ${JSON.stringify(r)}`); }
    assert.deepStrictEqual(fails, [], fails.join('\n'));
  }
});

test('brand blue produces a complete light theme', () => {
  const t = makeTheme('#0078d4', 'light');
  assert.ok(t.report.ok, JSON.stringify(t.report));
  for (const v of ['--bg1', '--bg2', '--fg', '--c1', '--hl1', '--d1', '--d5']) assert.ok(t.vars[v], v);
});

test('deterministic', () => {
  assert.deepStrictEqual(makeTheme('#3987e5', 'dark'), makeTheme('#3987e5', 'dark'));
});

test('highlight colour is amber or cyan, never a blind complement', () => {
  const { hueOf } = require('../src/theme');
  for (let h = 0; h < 360; h += 15) {
    const hx = makeTheme(hsl(h), 'dark').vars['--hl1'];
    const hue = hueOf(hx);
    assert.ok(Math.abs(hue - 75) < 25 || Math.abs(hue - 205) < 25, `hue ${h}: highlight hue ${Math.round(hue)}`);
  }
});
