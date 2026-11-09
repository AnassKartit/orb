// Characters: kind= picks the drawing, the rig is shared; the stage backdrop is a studio unless bg= says otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { compile, parse } = require('../src/prism');
const { loadPlayer } = require('./helpers/player-dom');

const root = path.resolve(__dirname, '..');
const stage = (mascot, ...acts) => `motion "T" 1280x720 6s accent=#7c5cff mode=dark\n  scene 6s\n    stage${mascot.stage || ''}\n      mascot "A" ${mascot.options || mascot}\n${acts.map(a => `      act "A" ${a}\n`).join('')}`;
const KINDS = ['owl', 'robot', 'fox', 'cat'];

test('kind= is checked and owl is the default', () => {
  const kind = options => parse(stage(options)).scenes[0].els[0].children[0].named.kind;
  assert.equal(kind('color=#58cc02'), undefined);
  for (const k of KINDS) assert.equal(kind(`kind=${k}`), k);
  assert.throws(() => parse(stage('kind=fx')), /line 4: unknown kind 'fx', did you mean 'fox'\?/);
  assert.throws(() => parse(stage('kind=dragon')), /line 4: unknown kind 'dragon'\. Options: owl, robot, fox, cat/);
  assert.throws(() => parse(stage('knd=fox')), /line 4: unknown option 'knd' on mascot, did you mean 'kind'\? mascot takes: kind color size belly beak x y mood/);
});

test('every kind runs every act on the same rig, and seeking back gives the same picture', () => {
  const acts = ['look to=left at=0.2 dur=0.6', 'wave at=0.8 dur=0.8', 'nod at=1.2 dur=0.4', 'laugh at=1.6 dur=0.5', 'hop at=2.2 dur=0.8', 'cheer at=3.2 dur=1', 'sad at=4.3 dur=0.5', 'feel to=love at=4.9 dur=0.3', 'idle at=5.3 dur=0.4'];
  for (const k of KINDS) for (const talk of ['talk at=0.1 dur=0.5', 'talk text="Hello there" at=0.1 dur=0.5']) {   // the plain page, then the page with the talking player
    const { context: w, nodes } = loadPlayer(compile(stage(`kind=${k} color=#19c3b2`, talk, ...acts)));
    const picture = t => { w.seek(t); return JSON.stringify(nodes.map(n => [n.attributes, n.style])); };
    const times = [0.3, 1.1, 1.7, 2.6, 3.5, 4.5, 5.2], first = times.map(picture);
    [...times].reverse().forEach((t, i) => assert.equal(picture(t), first[times.length - 1 - i], `${k} at ${t}`));
    assert.notEqual(first[0], first[3], `${k} moves`);
  }
});

test('the mouth opens with talk, the ground shadow stays down and shrinks under a hop', () => {
  for (const k of KINDS) {
    const { context: w, nodes } = loadPlayer(compile(stage(`kind=${k}`, 'talk text="Hello there, how are you" at=0.2 dur=2', 'hop at=3 dur=1')));
    const shadow = nodes.find(n => n.tagName === 'ellipse' && n.attributes.fill === '#000');
    const jaws = nodes.filter(n => n.attributes.opacity !== undefined && /^translate\(0,/.test(n.attributes.transform || ''));
    w.seek(2.6);
    assert.deepEqual([shadow.attributes.transform, shadow.attributes.opacity], ['translate(640,648) scale(1)', '0.2'], k);
    assert.ok(jaws.every(j => j.attributes.opacity === '0'), `${k}: mouth shut when silent`);
    let opened = false; for (let t = 0.3; t < 2.1; t += 0.05) { w.seek(t); opened = opened || jaws.some(j => j.attributes.opacity === '1'); }
    assert.ok(opened, `${k}: the mouth opens while talking`);
    w.seek(3.5);
    assert.match(shadow.attributes.transform, /^translate\(640,648\) scale\(0\.\d+\)$/, `${k}: the shadow does not leave the ground`);
    assert.ok(Number(shadow.attributes.opacity) < 0.2);
  }
});

test('stage backdrop: a studio that follows the theme, two colours of your own, or bg=sky', () => {
  const page = bg => loadPlayer(compile(stage({ stage: bg ? ` bg=${bg}` : '', options: 'kind=fox' })));
  const sky = p => p.nodes.find(n => n.className === 'el worldsky').style.background, clouds = p => p.nodes.filter(n => n.tagName === 'circle' && n.attributes.opacity === '0.92').length;
  assert.match(sky(page()), /^radial-gradient\(.*var\(--c3\).*var\(--bg1\)/);
  assert.equal(clouds(page()), 0);
  assert.equal(sky(page('sky')), 'linear-gradient(180deg, #bfe6ff, #f4fbff)');
  assert.equal(clouds(page('sky')), 16);
  assert.equal(sky(page('"#0b1020,#1b2a55"')), 'linear-gradient(180deg, #0b1020, #1b2a55)');
  assert.throws(() => parse(stage({ stage: ' bg=studio', options: 'kind=fox' })), /line 3: stage bg must be sky or one or two colours/);
});

test('the cast example compiles and the cheat sheet names the kinds and the backdrop', () => {
  const file = path.join(root, 'examples/cartoon/cast.orb'), html = compile(fs.readFileSync(file, 'utf8'), { baseDir: path.dirname(file) });
  assert.deepEqual(parse(fs.readFileSync(file, 'utf8')).scenes[0].els[0].children.filter(c => c.type === 'mascot').map(c => c.named.kind), KINDS);
  assert.ok(html.includes('player.pose('), 'talk text= uses the talking player');
  const spec = fs.readFileSync(path.join(root, 'docs/SPEC.md'), 'utf8');
  for (const word of ['kind=owl', 'robot', 'fox', 'cat', 'bg=sky']) assert.ok(spec.includes(word), word);
});
