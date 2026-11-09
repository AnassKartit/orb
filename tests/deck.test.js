// Slide decks: colours that follow the mode, ready looks, slide backgrounds, slide transitions and builds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { compile, parse } = require('../src/prism');
const { makeTheme, LOOKS, contrast } = require('../src/theme');
const { loadPlayer } = require('./helpers/player-dom');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'docs/SPEC.md'), 'utf8');
const data = html => JSON.parse(html.match(/window\.__PRISM__ = (.*);<\/script>/)[1]);
// deck('look=neon', [['bg=#101828', 'heading "A"'], ...]): one 4 second scene per entry, its options first, then its lines.
const deck = (motion, scenes) => `motion "T" 1280x720 ${motion}\n` + scenes.map(([options, ...lines]) => `  scene 4s ${options}\n` + lines.map(l => `    ${l}\n`).join('')).join('');
const two = (motion = '', scene = '', part = 'heading "A"') => deck(motion, [[scene, part], ['', 'heading "B"']]);
const H = 'heading "Hello"';
const folder = t => {   // a temp folder with two tiny pictures, removed after the test
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-deck-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['photo.jpg', 'hero.png', 'pic.png']) fs.writeFileSync(path.join(dir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return dir;
};

test('slide parts take every surface, border and text colour from a variable', () => {
  const ruleOf = selector => { const at = template.indexOf(`${selector} {`); assert.ok(at >= 0, selector); return template.slice(template.indexOf('{', at) + 1, template.indexOf('}', at)); };
  for (const selector of ['.heading', '.lede', '.note', '.panel', '.panel.soft', '.hdr', '.hdr.tint', '.card', '.card .lbl', '.disc', '.badge', '.outcome', '.outcome .pill', '.banner',
    '.hub .side', '.hub .ring', '.hub .ring .t', '.plus', '.cover', '.cover .tt', '.divider .dt', '.cover.thanks .tp', '.tabs', '.tab', '.tab.on', '.legendbar', '.chip', '.rail', '.tcols', '.tcol', '.th', '.slidenum']) {
    for (const declaration of ruleOf(selector).split(';')) {
      const [property, value = ''] = declaration.split(/:(.*)/s).map(part => part.trim());
      if (/^(background|color|border|border-right|border-bottom)$/.test(property)) assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${selector} { ${declaration.trim()} }`);
    }
  }
});

test('the page carries its mode, which the slide colours follow', () => {
  const mode = source => data(compile(source)).mode;
  assert.equal(mode(two('accent=#ff2d78 mode=light')), 'light');
  assert.equal(mode(two('accent=#ff2d78 mode=dark')), 'dark');
  assert.equal(mode(two('accent=#ff2d78')), 'dark');
  assert.equal(mode(two('')), 'dark');                         // no look chosen: the derived one is dark
  assert.equal(mode(two('bg=ms')), 'light');                   // the older themes fix their own mode
  assert.equal(mode(two('bg=aurora accent=#ff2d78 mode=light')), 'dark');
  assert.equal(mode(two('look=paper')), 'light');
  assert.equal(mode(two('look=paper mode=dark')), 'dark');
  assert.equal(loadPlayer(compile(two('look=neon'))).context.document.body.dataset.mode, 'dark');
  assert.match(template, /\[data-mode\] \{[^}]*--card:/);
  assert.match(template, /\[data-mode="dark"\] \{[^}]*--card:/);
});

test('header bands carry white text for any accent, in both modes', () => {
  const accents = ['#d92626', '#d98026', '#d9d926', '#80d926', '#26d926', '#26d980', '#26d9d9', '#2680d9', '#2626d9', '#8026d9', '#d926d9', '#d92680', '#ffffff', '#000000', '#ff2d78', '#0078d4'];
  for (const mode of ['dark', 'light']) for (const accent of accents) {
    const vars = makeTheme(accent, mode).vars;
    for (const band of ['--band1', '--band2']) assert.ok(contrast(vars[band], '#ffffff') >= 4.5, `${mode} ${accent} ${band} ${vars[band]}`);
  }
});

test('looks are data on top of the palette; accent, mode and font still win', () => {
  assert.deepEqual(Object.keys(LOOKS), ['midnight', 'paper', 'neon']);
  for (const [name, look] of Object.entries(LOOKS)) for (const variable of Object.keys(look.vars)) assert.ok(template.includes(variable), `${name} sets ${variable}, which the page does not use`);
  const css = motion => data(compile(two(motion))).themeCss;
  const midnight = css('look=midnight');
  assert.ok(midnight.startsWith(makeTheme(LOOKS.midnight.accent, 'dark').css));
  assert.ok(midnight.includes(`:root,body{--bg1:${LOOKS.midnight.bg[0]};--bg2:${LOOKS.midnight.bg[1]}}[data-mode]{--card:`));
  assert.ok(css('look=midnight accent=#ff2d78').startsWith(makeTheme('#ff2d78', 'dark').css));
  const light = css('look=midnight mode=light');
  assert.ok(light.startsWith(makeTheme(LOOKS.midnight.accent, 'light').css));
  assert.ok(!light.includes(LOOKS.midnight.bg[0]), 'the dark backdrop is not used in light mode');
  assert.match(css('look=paper'), /--head-font:"Iowan Old Style"/);
  assert.ok(css('look=paper font=mono').endsWith(':root,body{--font:ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace}[data-mode]{--head-font:inherit}'));
});

test('slide backgrounds: colour, gradient, picture, veil, deck default and the mode each one asks for', t => {
  const gradient = 'linear-gradient(135deg,#1b2340,#3b0f4f)';
  const source = deck('accent=#0ea5a4 mode=light slide-bg=#fdf6e3', [['', H], ['bg=#101828', H], [`bg="${gradient}"`, H], ['bg=photo.jpg dim=.4', H], ['bg=photo.jpg dim=.3 mode=light', H]]);
  const html = compile(source, { baseDir: folder(t) }), m = data(html);
  assert.deepEqual(m.scenes.map(s => [s.bg, s.mode, s.dim]), [['#fdf6e3', 'light', undefined], ['#101828', 'dark', undefined], [gradient, 'dark', undefined], ['@a0', 'dark', 0.4], ['@a0', 'light', 0.3]]);
  assert.deepEqual(Object.keys(m.assets), ['a0'], 'a picture used on two slides is embedded once');
  assert.ok(m.themeCss.includes('.scene[data-mode="dark"]{--bg1:'), 'dark slides in a light deck bring the dark palette');
  assert.ok(!data(compile(two('accent=#0ea5a4 mode=dark', 'bg=#101828'))).themeCss.includes('.scene['), 'no second palette when no slide needs one');
  const scenes = loadPlayer(html).nodes.filter(n => n.className === 'scene');
  assert.deepEqual(scenes.map(n => n.dataset.mode), [undefined, 'dark', 'dark', 'dark', undefined]);
  assert.equal(scenes[1].style.background, '#101828');
  assert.equal(scenes[2].style.background, gradient);
  assert.ok(scenes[3].style.background.startsWith('linear-gradient(rgba(0,0,0,0.4),rgba(0,0,0,0.4)),url("data:image/jpeg;base64,'));
  assert.ok(scenes[3].style.background.endsWith('") center/cover no-repeat'));
  assert.ok(scenes[4].style.background.startsWith('linear-gradient(rgba(255,255,255,0.3),'), 'on a light slide the veil is light');
  assert.match(template, /\.scene\.hasbg \.cover, \.scene\.hasbg \.divider \{ background:none; \}/);
});

test('slide transitions: in and out per scene, and a deck default that leaves the first slide alone', () => {
  const m = parse(deck('transition=slide', [['', H], ['', H], ['in=zoom out=fade', H], ['in=none out=none', H]]));
  assert.deepEqual(m.scenes.map(s => [s.in, s.out]), [[undefined, undefined], ['slide', undefined], ['zoom', 'fade'], [undefined, 'none']]);
  assert.deepEqual(parse(two()).scenes.map(s => [s.in, s.out]), [[undefined, undefined], [undefined, undefined]]);
});

test('in the page a transition moves both slides and every frame depends on the time alone', () => {
  // speed=1.2 makes each transition 0.5 s, so the middle of one is an exact number
  const html = compile(deck('accent=#0ea5a4 speed=1.2', [['', H], ['in=slide', H], ['in=wipe', H], ['in=zoom', H], ['in=fade', H], ['', H]]));
  const { context: w, nodes } = loadPlayer(html), scenes = nodes.filter(n => n.className === 'scene');
  const at = t => { w.seek(t); return scenes.map(n => n.style.display === 'none' ? null : [n.style.opacity, n.style.transform, n.style.clipPath]); };
  const still = [1, '', ''];
  assert.deepEqual(at(3.9), [still, null, null, null, null, null], 'a slide that the next one replaces holds to its end');
  assert.deepEqual(at(4.25), [[1, 'translateX(-640px)', ''], [1, 'translateX(640px)', ''], null, null, null, null], 'slide: the old one leaves as the new one arrives');
  assert.deepEqual(at(4.5), [null, still, null, null, null, null]);
  assert.deepEqual(at(8.25).slice(1, 3), [[1, '', 'inset(0 0 0 50%)'], [1, '', 'inset(0 50% 0 0)']]);
  const zoom = at(12.25);
  assert.deepEqual([zoom[2][0], zoom[2][1], zoom[3][0]], [0.5, 'scale(1.03)', 0.5]);
  assert.match(zoom[3][1], /^scale\(0\.95\d*\)$/);
  assert.deepEqual(at(16.25).slice(3, 5), [[0.5, '', ''], [0.5, '', '']]);
  const leaving = at(19.8)[4];   // the next slide has no move of its own, so this one fades out with a slight scale, as before
  assert.ok(leaving[0] > 0.4 && leaving[0] < 0.5 && /^scale\(1\.0\d+\)$/.test(leaving[1]));
  assert.deepEqual(at(23.99), [null, null, null, null, null, still], 'the last slide holds');
  const times = Array.from({ length: 120 }, (_, i) => i * 0.2 + 0.05), first = times.map(at);
  [...times].reverse().forEach((t, i) => assert.deepEqual(at(t), first[times.length - 1 - i], `seeking back to ${t}`));
});

test('present mode: a slide that does not fade is left at once, a fading one 0.45 s before its end', () => {
  for (const [option, from] of [['', 3.55], ['in=slide', 4]]) {
    const page = loadPlayer(compile(deck('accent=#0ea5a4 present=on', [['', H], [option, H]])), '');
    page.key({ code: 'ArrowRight', preventDefault() {} });   // finish the first build
    page.key({ code: 'ArrowRight', preventDefault() {} });   // go on
    assert.deepEqual({ ...page.context.__PRISM_PRESENT__() }, { cur: 1, playing: true, t: from });
  }
});

test('build= sets how slide parts enter; in= on a part still wins; layout boxes and covers keep their own', () => {
  const lines = ['heading "H"', 'row', '  card "A"', '  card "B" in=fade', 'table', '  col header="C"', '    bullets "x"'];
  const entrances = motion => { const m = parse(deck(motion, [['', 'cover "C"'], ['', ...lines], ['', 'title "Plain"']])); const flat = els => els.flatMap(e => [[e.type, e.in], ...flat(e.children || [])]); return m.scenes.map(s => flat(s.els)); };
  assert.deepEqual(entrances('build=pop'), [[['cover', 'fade']], [['heading', 'pop'], ['row', 'none'], ['card', 'pop'], ['card', 'fade'], ['table', 'pop'], ['col', 'none'], ['bullets', 'pop']], [['title', 'rise']]]);
  assert.deepEqual(entrances('')[1], [['heading', 'lift'], ['row', 'none'], ['card', 'lift'], ['card', 'fade'], ['table', 'none'], ['col', 'none'], ['bullets', 'fade']]);
  assert.deepEqual(entrances('build=none')[1].map(([, entrance]) => entrance), ['none', 'none', 'none', 'fade', 'none', 'none', 'none']);
});

test('every slide part honours in=, at=, dur= and ease= in the page', () => {
  const source = deck('accent=#0ea5a4', [['', 'card "A" in=fade at=1 dur=1', 'card "B" in=fade at=1 dur=1 ease=linear', 'card "G" in=grow at=1 dur=1 ease=linear', 'steps "a" "b" in=none', 'bullets "x" "y" in=none', 'banner "W" in=wipe at=1 dur=1 ease=linear'], ['', 'hub "Fade" in=fade'], ['', 'hub "Pop"']]);
  const { context: w, nodes } = loadPlayer(compile(source));
  const one = name => nodes.filter(n => n.className === name), cards = one('el card');
  w.seek(0.01);
  assert.equal(cards[0].style.opacity, 0);
  for (const li of nodes.filter(n => n.tagName === 'li')) assert.equal(li.style.opacity, 1, 'in=none: the items are simply there');
  w.seek(1.5);
  assert.equal(cards[0].style.opacity, 0.875);                 // ease out, half way
  assert.equal(cards[1].style.opacity, 0.5);                   // ease=linear
  assert.equal(cards[2].style.transform, 'scaleY(0.5)');
  assert.equal(one('el banner')[0].style.clipPath, 'inset(0 50% 0 0)');
  w.seek(4.4);
  const [fade, pop] = one('el hub'), [ringOfFade, ringOfPop] = one('ring');
  assert.ok(fade.style.opacity > 0 && fade.style.opacity < 1 && fade.style.transform === undefined && ringOfFade.style.transform === undefined, 'in=fade replaces the hub\'s own move');
  w.seek(8.4);
  assert.match(pop.style.transform, /^scale\(/); assert.match(ringOfPop.style.transform, /^scale\(/);
});

test('unknown words fail with the line number and the closest valid word', () => {
  for (const [motion, scene, part, pattern] of [
    ['look=midnigt', '', H, /line 1: unknown look 'midnigt', did you mean 'midnight'\?/],
    ['look=glass', '', H, /line 1: unknown look 'glass'\. Options: midnight, paper, neon/],
    ['look=paper bg=ms', '', H, /line 1: use look= or bg=, not both/],
    ['transition=sldie', '', H, /line 1: unknown transition 'sldie', did you mean 'slide'\?/],
    ['build=popp', '', H, /line 1: unknown build 'popp', did you mean 'pop'\?/],
    ['transiton=slide', '', H, /line 1: unknown motion option 'transiton', did you mean 'transition'\?/],
    ['slide-bg=navy', '', H, /line 1: background 'navy' must be a colour \(#101828\), a gradient .* or an image file/],
    ['slide-dim=2', '', H, /line 1: slide-dim must be a number from 0 to 1/],
    ['in=slide', '', H, /line 1: in= goes on a scene line; for every slide write transition= on the motion line/],
    ['bg=#101828', '', H, /line 1: bg= on the motion line names an older theme .* write slide-bg=#101828/],
    ['', 'in=zom', H, /line 2: unknown transition 'zom', did you mean 'zoom'\?/],
    ['', 'out=fde', H, /line 2: unknown exit 'fde', did you mean 'fade'\?/],
    ['', 'bgg=#101828', H, /line 2: unknown scene option 'bgg', did you mean 'bg'\?/],
    ['', 'transition=fade', H, /line 2: transition= goes on the motion line; on a scene write in=/],
    ['', 'bg=#12', H, /line 2: background '#12' must be a colour/],
    ['', 'bg="linear-gradient(135deg, #1b2340, #3b0f4f)"', H, /line 2: background .* Write the gradient without spaces/],
    ['', 'bg=missing.jpg', H, /line 2: image 'missing.jpg' not found/],
    ['', 'bg=#101828 dim=dark', H, /line 2: dim must be a number from 0 to 1/],
    ['', 'bg=#101828 mode=drak', H, /line 2: unknown mode 'drak', did you mean 'dark'\?/],
    ['', 'dim=.4', H, /line 2: dim= on a scene goes with bg=/],
    ['', '', 'card "A" in=popp', /line 3: unknown animation 'popp', did you mean 'pop'\?/],
    ['', '', 'card "A" ease=sprng', /line 3: unknown ease 'sprng', did you mean 'spring'\?/],
  ]) assert.throws(() => compile(two(motion, scene, part), { baseDir: os.tmpdir() }), pattern, [motion, scene, part].join(' | '));
  assert.doesNotThrow(() => parse(two('steps=on')));   // an option no known name is close to passes, as it always did
});

test('the example deck and the cheat sheet sample compile, and the cheat sheet names every new word', t => {
  const file = path.join(root, 'examples/decks/showcase.orb');
  const m = data(compile(fs.readFileSync(file, 'utf8'), { baseDir: path.dirname(file) }));
  assert.equal(m.look, 'midnight');
  assert.deepEqual(m.scenes.map(s => s.in), [undefined, 'slide', 'zoom', 'wipe', 'slide', 'fade']);
  assert.equal(m.scenes.filter(s => s.bg).length, 4);
  assert.deepEqual(Object.keys(m.assets), ['a0']);
  const sample = spec.match(/^Slide decks[^\n]*\n\n((?: {4}[^\n]*\n)+)/m)[1].replace(/^ {4}/gm, '');
  assert.equal(data(compile(sample, { baseDir: folder(t) })).scenes.length, 3);
  for (const word of ['look=midnight', 'look=paper', 'look=neon', 'transition=slide', 'build=pop', 'build=none', 'slide-bg=', 'slide-dim=', 'dim=0..1', 'in=fade|slide|zoom|wipe', 'in=none', 'out=fade', 'out=none', 'mode=light|dark', 'grow']) assert.ok(spec.includes(word), word);
});
