// The options every scene element takes (colour, font, size, place, box), the chart and image options, scene
// alignment, and the error for an option an element does not take.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { compile, parse } = require('../src/prism');
const { loadPlayer } = require('./helpers/player-dom');

const root = path.resolve(__dirname, '..');
const spec = fs.readFileSync(path.join(root, 'docs/SPEC.md'), 'utf8');
const one = (...lines) => `motion "T" 1280x720 accent=#0ea5a4\n  scene 4s\n${lines.map(l => `    ${l}\n`).join('')}`;
const page = (...lines) => loadPlayer(compile(one(...lines), { baseDir: path.join(root, 'examples/decks/assets') }));
const styled = (p, key, value) => p.nodes.filter(n => n.style[key] === value);
// one line of every element that is a box on the page (orb needs WebGL, so it is left to the browser)
const EVERY = ['eyebrow "A"', 'title "A"', 'sub "A"', 'text "A"', 'count "A" 12', 'bars 1 2 3', 'line 1 2 3', 'donut a=1 b=2', 'shape circle', 'heading "A"', 'lede "A"', 'note "A"', 'banner "A"',
  'card "A"', 'panel header="A"', 'steps "A" "B"', 'bullets "A" "B"', 'outcome "A"', 'hub "A"', 'image image=dusk.jpg', 'plus', 'tabs "A" "B"', 'legend "A"', 'table', 'row', 'col', 'grid 2', 'cover "A"', 'divider "A"'];

test('every element takes the same place and box options, through one helper', () => {
  for (const line of EVERY) {
    const p = page(`${line} x=12 y=-7 rotate=3 opacity=.5 bg=#123456 pad=9 radius=5 border=#ffffff font=mono h=90`);
    const [node] = styled(p, 'translate', '12px -7px');
    assert.ok(node, line);
    assert.deepEqual([node.style.rotate, node.style.background, node.style.padding, node.style.border, node.style.fontFamily], ['3deg', '#123456', '9px', '2px solid #ffffff', 'ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace'], line);
    if (!/^bars/.test(line)) assert.equal(node.style.borderRadius, '5px', line);            // on bars, radius rounds the bars
    if (!/^(bars|line|donut)/.test(line)) assert.equal(node.style.height, '90px', line);     // charts size their drawing instead
    p.context.seek(3.4);
    assert.equal(node.style.opacity, 0.5, `${line}: opacity= multiplies what the entrance set`);
    assert.equal(node.style.transform === undefined || !/12px/.test(node.style.transform), true, `${line}: x and y leave transform to the entrance`);
  }
});

test('type options reach the words: color, size, weight, spacing, upper, align', () => {
  const p = page('text "A" color=#ff0000 size=40 weight=800 spacing=2 upper=on align=right shadow=on', 'count "N" 5 color=#00ff00 size=64', 'title "Big" size=1.5x', 'heading "Named" size=s', 'banner "B" shadow=on');
  const [text] = styled(p, 'color', '#ff0000');
  assert.deepEqual([text.style.fontSize, text.style.fontWeight, text.style.letterSpacing, text.style.textTransform, text.style.textAlign, text.style.alignSelf, text.style.textShadow],
    ['40px', '800', '2px', 'uppercase', 'right', 'flex-end', '0 10px 30px rgba(0,0,0,.35)']);
  assert.equal(text.parentElement.style.width, '100%', 'an aligned element makes its block span the stage');
  assert.equal(styled(p, 'color', '#00ff00').length, 1);          // the fake page has no selectors; the browser also colours the number itself
  assert.equal(styled(p, 'zoom', 1.5).length, 1, 'size=1.5x scales the whole element');
  assert.equal(p.nodes.find(n => n.className === 'el heading s').style.fontSize, undefined, 'a named size stays a named size');
  assert.equal(p.nodes.find(n => n.className === 'el banner').style.boxShadow, '0 10px 30px rgba(0,0,0,.35)', 'a box gets a box shadow');
  assert.match(fs.readFileSync(path.join(root, 'src/template.html'), 'utf8'), /\.inked \.last \{ background:none; color:inherit; \}/);
});

test('w is pixels or a percentage; inside a row a bare number on a share part stays its share', () => {
  const p = page('text "A" w=300', 'text "B" w=50%', 'row', '  card "Share" w=2', '  card "Fixed" w=320px');
  assert.equal(styled(p, 'width', '300px').length, 1);
  assert.equal(styled(p, 'width', '50%').length, 1);
  const cards = p.nodes.filter(n => n.className === 'el card');
  assert.deepEqual(cards.map(c => [c.style.flex, c.style.width]), [['2', undefined], ['none', '320px']]);
});

test('scene align= and valign= move the whole block', () => {
  const html = compile('motion "T" 1280x720 accent=#0ea5a4\n  scene 3s align=left valign=top\n    title "A"\n  scene 3s valign=center align=center\n    heading "B"\n  scene 3s\n    title "C"');
  const p = loadPlayer(html), scenes = p.nodes.filter(n => n.className === 'scene'), stacks = p.nodes.filter(n => /^stack /.test(n.className));
  assert.deepEqual([stacks[0].style.alignItems, stacks[0].style.textAlign, stacks[0].style.width, scenes[0].style.justifyContent], ['flex-start', 'left', '100%', 'flex-start']);
  assert.deepEqual([stacks[1].style.justifyContent, stacks[1].style.textAlign, stacks[1].style.alignItems], ['center', 'center', undefined], 'a slide keeps its parts stretched');
  assert.deepEqual([stacks[2].style.alignItems, scenes[2].style.justifyContent], [undefined, undefined]);
  assert.throws(() => parse('motion "T"\n  scene 3s valign=middle\n    title "A"'), /line 2: unknown valign 'middle'\. Options: top, center, bottom/);
});

test('bars: colours per bar, one colour, marked bar colour, tag, gap, corners, grid, values and labels', () => {
  const bars = (p, rx = '10') => p.nodes.filter(n => n.tagName === 'rect' && n.attributes.rx === rx && n.attributes.fill !== 'none');
  const words = p => p.nodes.filter(n => n.tagName === 'text').map(n => n.textContent);
  assert.deepEqual(bars(page('bars 1 2 3 colors=#aa0000,#00bb00')).map(r => r.attributes.fill), ['#aa0000', '#00bb00', '#aa0000']);
  assert.deepEqual(bars(page('bars 1 2 3 bar=#123456 peak-color=#ff0000')).map(r => r.attributes.fill), ['#123456', '#123456', '#ff0000']);
  assert.deepEqual(bars(page('bars 3 1 2 bar=#123456 low="LOW" low-color=#0000ff')).map(r => r.attributes.fill), ['#123456', '#0000ff', '#123456']);
  assert.ok(bars(page('bars 1 2 3')).every(r => /^url\(#/.test(r.attributes.fill)), 'no colour option: the theme gradients, as before');
  const tagged = page('bars 1 2 3 labels=Mon,Tue,Wed tag="NEW" tag-at=Tue peak="TOP" gap=30 radius=4 grid=on label-size=30 value-size=33 label-color=#abcdef value-color=#fedcba');
  assert.deepEqual(words(tagged), ['1', '2', '3', 'Mon', 'Tue', 'Wed', 'TOP', 'NEW']);
  const pills = tagged.nodes.filter(n => n.tagName === 'rect' && n.attributes.rx === '14');
  assert.deepEqual(pills.map(r => r.attributes.fill), ['var(--hl1)', 'var(--band1)']);
  assert.ok(Number(pills[1].attributes.x) < Number(pills[0].attributes.x), 'the tag sits on the bar that tag-at names');
  assert.equal(bars(tagged, '4').length, 3);
  assert.equal(tagged.nodes.filter(n => n.tagName === 'line').length, 5, 'base line and four grid lines');
  const text = name => tagged.nodes.find(n => n.tagName === 'text' && n.textContent === name).attributes;
  assert.deepEqual([text('Mon')['font-size'], text('Mon').fill, text('1')['font-size'], text('1').fill], ['30', '#abcdef', '33', '#fedcba']);
  const bare = page('bars 1 2 3 labels=off values=off'); bare.context.seek(3.5);
  assert.deepEqual(bare.nodes.filter(n => n.tagName === 'text').map(n => n.attributes.opacity), ['0', '0', '0'], 'no labels, and the values stay hidden');
  assert.deepEqual(parse(one('bars 1 2 3 tag="X" tag-at=3')).scenes[0].els.find(e => e.type === 'bars').tagAt, 2);
});

test('line and donut: stroke, fill, dots, colours, hole, legend', () => {
  const p = page('line 1 3 2 stroke=#00ff88 fill=off dots=off values=off label-color=#abcdef', 'donut a=1 b=1 c=2 colors=#111111,#222222 hole=.5 labels=off');
  p.context.seek(3.5);
  assert.equal(p.nodes.find(n => n.tagName === 'path' && n.attributes['stroke-width'] === '6').attributes.stroke, '#00ff88');
  assert.ok(p.nodes.filter(n => n.tagName === 'circle' && n.attributes.cx !== undefined).every(c => c.attributes.r === '0'), 'dots=off');
  assert.ok(p.nodes.some(n => n.tagName === 'path' && n.attributes.opacity === '0'), 'fill=off');
  const arcs = p.nodes.filter(n => n.tagName === 'circle' && n.attributes.transform === 'rotate(-90)');
  assert.deepEqual(arcs.map(c => [c.attributes.stroke, c.attributes['stroke-width']]), [['#111111', '63'], ['#222222', '63'], ['#111111', '63']]);
  assert.equal(p.nodes.find(n => n.className === 'legend').style.display, 'none');
  const plain = page('donut a=1 b=2');
  assert.deepEqual(plain.nodes.filter(n => n.tagName === 'circle' && n.attributes.transform === 'rotate(-90)').map(c => [c.attributes.stroke, c.attributes['stroke-width']]), [['var(--d1)', '42'], ['var(--d2)', '42']]);
  assert.deepEqual(parse(one('donut web=52% app=48 opacity=.5 hole=.4')).scenes[0].els.find(e => e.type === 'donut').slices, ['web', 'app'], 'options are not slices');
});

test('images: a default size that fits the stage, and w, h, fit', () => {
  const img = (...options) => page(`image image=dusk.jpg ${options.join(' ')}`).nodes.find(n => n.tagName === 'img');
  assert.equal(img().style.maxHeight, '432px');
  assert.deepEqual([img('w=400').style.width, img('w=400').style.maxHeight, img('w=400').style.objectFit], ['400px', undefined, undefined]);
  assert.deepEqual([img('w=400', 'h=200').style.height, img('w=400', 'h=200').style.objectFit, img('w=400', 'h=200', 'fit=contain').style.objectFit], ['200px', 'cover', 'contain']);
  assert.equal(img('shadow=on', 'radius=16').style.boxShadow, '0 10px 30px rgba(0,0,0,.35)');
});

test('an option an element does not take fails with the line, the closest option and the list', () => {
  for (const [line, pattern] of [
    ['bars 1 2 3 colour=#ff0000', /line 3: unknown option 'colour' on bars, did you mean 'color'\? bars takes: title labels values grid colors .* peak .* tag tag-at color font size .* upper at dur stagger in ease from mt/],
    ['title "A" colr=#ff0000', /line 3: unknown option 'colr' on title, did you mean 'color'\? title takes: color font size weight align x y w h rotate opacity bg pad radius border shadow spacing upper at dur/],
    ['title "A" peak="X"', /line 3: unknown option 'peak' on title\. title takes: color font/],
    ['card "A" icn=gear', /unknown option 'icn' on card, did you mean 'icon'\? card takes: icon label sub color/],
    ['image image=dusk.jpg fitt=cover', /unknown option 'fitt' on image, did you mean 'fit'\? image takes: image fit color/],
    ['donut a=1 b=2 hol=.5x', /unknown option 'hol' on donut, did you mean 'hole'\?/],
    ['stage', /^$/], ['text "A" align=middle', /line 3: unknown align 'middle'\. Options: left, center, right/],
    ['text "A" x=left', /line 3: x must look like x=-40, found 'left'/], ['text "A" opacity=2', /opacity must look like opacity=\.6/], ['text "A" size=huge', /size must be pixels \(size=40\) or a multiple of the usual size \(size=1\.4x\), found 'huge'/],
    ['heading "A" size=m', /size must be pixels .*, or s, found 'm'/], ['text "A" w=wide', /w must look like w=320 or w=50%/], ['text "A" weight=heavy', /weight must look like weight=800/],
    ['bars 1 2 3 tag="X" tag-at=4', /line 3: tag-at must be a bar's position \(1 to 3\), found '4'/], ['bars 1 2 labels=A,B tag="X" tag-at=C', /tag-at must be a bar's position \(1 to 2\) or one of its labels \(A, B\), found 'C'/],
    ['bars 1 2 3 grid=yes', /unknown grid 'yes'\. Options: on, off/], ['image image=dusk.jpg fit=fill', /unknown fit 'fill'\. Options: cover, contain/],
  ]) {
    if (line === 'stage') { assert.throws(() => parse(one('stage', '  mascot "A" colr=#ff0000')), /line 4: unknown option 'colr' on mascot, did you mean 'color'\? mascot takes: /); continue; }
    assert.throws(() => parse(one(line)), pattern, line);
  }
});

test('the example compiles and the cheat sheet names every option', () => {
  const file = path.join(root, 'examples/customise.orb');
  assert.ok(compile(fs.readFileSync(file, 'utf8'), { baseDir: path.dirname(file) }).includes('__PRISM__'));
  for (const word of ['color=', 'font=', 'size=', 'weight=', 'align=', 'x=', 'y=', 'w=', 'h=', 'rotate=', 'opacity=', 'bg=', 'pad=', 'radius=', 'border=', 'shadow=', 'spacing=', 'upper=on',
    'colors=', 'bar=', 'peak-color=', 'low-color=', 'label-color=', 'value-color=', 'label-size=', 'value-size=', 'gap=', 'values=off', 'labels=off', 'grid=on', 'tag=', 'tag-at=', 'stroke=', 'fill=off', 'dots=off', 'hole=', 'fit=cover|contain', 'valign=']) assert.ok(spec.includes(word), word);
});
