const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { compile, parse } = require('../src/prism');
const core = require('../src/player-state');
const { loadPlayer } = require('./helpers/player-dom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'examples/interactive/hoot.prism'), 'utf8');
const machine = () => parse(source).interactive.machines[0];
const event = (at, kind, name, value) => ({ at, kind, name, value });
const buildExample = file => compile(fs.readFileSync(path.join(root, file), 'utf8'), { baseDir: path.dirname(path.join(root, file)) });
const data = html => JSON.parse(html.match(/window\.__PRISM__ = (.*);<\/script>/)[1]);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

// Re-captured on purpose when the player runtime changes (last: the last scene holds; decks carry no built-in brand).
test('player examples match their recorded hashes', () => {
  for (const [file, hash] of Object.entries(require('./player-baseline.json'))) {
    const html = buildExample(file);
    assert.equal(crypto.createHash('sha256').update(html).digest('hex'), hash, file);
  }
});

test('machine grammar preserves source lines, typed inputs, inline and indented state actions', () => {
  const m = machine();
  assert.deepEqual(m.inputs.map(i => i.kind), ['bool', 'trigger', 'number']);
  assert.equal(m.states[2].duration, 1.2);
  assert.equal(m.states[2].next, 'idle');
  const text = source.replace('state idle: act idle loop', 'state idle:\n          act idle loop');
  assert.equal(parse(text).interactive.machines[0].states[0].actions[0].loop, true);
  assert.equal(m.inputs[0].line, 6);
  // Language expansion and named options inside quoted strings still work.
  const expanded = 'let duration = 1.2\n' + source.replace('dur=1.2', 'dur={duration}');
  assert.equal(parse(expanded).interactive.machines[0].states[2].duration, 1.2);
});

test('new parse errors give source lines and suggestions', () => {
  for (const [from, to, pattern] of [
    ['input hovered bool', 'input hovered bol', /line 6:.*did you mean 'bool'/],
    ['input hovered bool', 'imput hovered bool', /line 6:.*did you mean 'input'/],
    ['state giggle on poke', 'state giggle on pok', /did you mean 'poke'/],
    ['when hovered', 'when hoverd', /did you mean 'hovered'/],
    ['act laugh dur=1.2', 'act lauh dur=1.2', /did you mean 'laugh'/],
    ['-> idle', '-> idl', /did you mean 'idle'/],
    ['on hover "Hoot"', 'on hove "Hoot"', /did you mean 'hover'/],
    ['blend=0.2', 'blnd=0.2', /did you mean 'blend'/],
    ['0..1', '1..0', /increasing range/],
    ['input poke trigger', 'input poke bool', /use on for trigger/],
    ['act laugh dur=1.2', 'act laugh dur=-1', /dur must be/],
    ['input poke trigger', 'input poke trigger\n        input poke trigger', /duplicate input/],
  ]) assert.throws(() => parse(source.replace(from, to)), pattern, to);
  const audio = attrs => `motion "A" 3s\n  scene 3s\n    audio "line.wav" ${attrs}`;
  assert.throws(() => parse(audio('volum=0.5')), /line 3:.*did you mean 'volume'/);
  for (const attrs of ['volume=2', 'volume=0.5s', 'dur=0', 'at=wat', 'dur=-1', 'at=1x', 'dur=2oops']) assert.throws(() => parse(audio(attrs)), /line 3:/);
  assert.throws(() => compile(audio('')), /line 3: audio 'line.wav' not found/);
  assert.throws(() => parse(source.replace('on hover "Hoot" hovered', 'on hover "Hoot" poke')), /hover requires a bool/);
});

test('audio build, compact envelope, deduplication and durations are deterministic', () => {
  const one = buildExample('examples/cartoon/talk.prism'), two = buildExample('examples/cartoon/talk.prism');
  assert.equal(one, two);
  const m = data(one), asset = m.audioAssets.s0;
  assert.equal(Object.keys(m.audioAssets).length, 1);
  assert.equal(asset.fps, 30); assert.equal(asset.duration, 2.4);
  const samples = Buffer.from(asset.envelope, 'base64');
  assert.equal(samples.length, 72); assert.ok(samples.includes(0)); assert.ok(samples.includes(255));
  assert.equal(m.audioClips.length, 2); assert.equal(m.audioClips[0].dur, 2.4);
  assert.ok(asset.src.startsWith('data:audio/wav;base64,'));
  const decoded = { ...asset, samples };
  near(core.envelope(decoded, 0.1), core.envelope(decoded, 0.1));
  assert.equal(core.envelope(decoded, -1), 0); assert.equal(core.envelope(decoded, 2.4), 0);
  assert.equal(core.envelope(decoded, .35), 0); assert.ok(core.envelope(decoded, .1) > .5);
});

test('text syllables are seeded, repeatable, varied and silent outside the line', () => {
  const line = 'Hello Hoot, can you hear me?';
  const frames = Array.from({ length: 90 }, (_, i) => core.syllables(line, i / 30, 3, 123));
  assert.deepEqual(frames, Array.from({ length: 90 }, (_, i) => core.syllables(line, i / 30, 3, 123)));
  assert.notDeepEqual(frames, Array.from({ length: 90 }, (_, i) => core.syllables(line, i / 30, 3, 124)));
  assert.ok(new Set(frames).size > 15); assert.ok(frames.every(x => x >= 0 && x <= 1));
  assert.equal(core.syllables(line, 3, 3), 0); assert.equal(core.syllables('', 1, 3), 0);
});

test('pure machine replay blends hover, handles repeated triggers, returns and seeks backwards', () => {
  const m = machine(), events = [event(1, 'set', 'hovered', true), event(2, 'fire', 'poke')];
  assert.equal(core.sampleMachine(m, events, .5).state, 'idle');
  const half = core.sampleMachine(m, events, 1.1);
  assert.equal(half.state, 'curious'); near(half.layers[0].weight, .5); near(half.layers[1].weight, .5);
  assert.equal(core.sampleMachine(m, events, 2.5).state, 'giggle');
  assert.equal(core.sampleMachine(m, events, 3.3).state, 'idle');
  assert.deepEqual(core.sampleMachine(m, events, 1.1), half);
  const repeat = [...events, event(2.7, 'fire', 'poke')];
  assert.equal(core.sampleMachine(m, repeat, 3.8).state, 'giggle');
  assert.equal(core.sampleMachine(m, repeat, 4).state, 'idle');
  for (const t of [.1, 1, 1.01, 1.2, 2.01, 3.21, 10]) near(core.sampleMachine(m, repeat, t).layers.reduce((sum, l) => sum + l.weight, 0), 1);
});

test('initial negated conditions and pointer event history are pure', () => {
  const m = parse(source.replace('when hovered', 'when !hovered')).interactive.machines[0];
  assert.equal(core.sampleMachine(m, [], .5).state, 'curious');
  const events = [{ at: 1, kind: 'pointer', value: [.2, -.8] }];
  assert.deepEqual(core.sampleMachine(m, events, 2).pointer, [.2, -.8]);
  assert.deepEqual(core.sampleMachine(m, events, .5).pointer, [0, 0]);
});

test('state poses use local clocks, actual audio levels and numeric crossfades', () => {
  const base = { brow: 0, browY: 0, lid: 1, pupil: 1, open: 0, blush: 0, wing: 0, droop: 0, squint: 0 };
  const moods = { neutral: base }, assets = { s0: { samples: [0, 255, 128], fps: 30, duration: .1 } };
  const idle = core.pose(base, moods, [], .04, [0, 0], .3, 1, assets, true);
  const talk = core.pose(base, moods, [{ verb: 'talk', at: 0, dur: 1, audio: 's0' }], .04, [0, 0], .3, 1, assets, true);
  assert.equal(talk.open, 1);
  const mixed = core.mixPoses([{ value: idle, weight: .75 }, { value: talk, weight: .25 }]);
  near(mixed.open, .25); near(mixed.wr, idle.wr * .75 + talk.wr * .25);
  const laugh = core.pose(base, moods, [{ verb: 'laugh', at: 0, dur: 1.2 }], .4, [0, 0], .3, 1, assets, true);
  assert.ok(laugh.jy < 0);
  assert.deepEqual(laugh, core.pose(base, moods, [{ verb: 'laugh', at: 0, dur: 1.2 }], .4, [0, 0], .3, 1, assets, true));
  const look = core.pose(base, moods, [{ verb: 'look', to: 'pointer', at: 0, dur: 2 }], 3, [1, -.5], .3, 1, assets, true);
  assert.ok(look.px > 10 && look.rot > .05);
});

test('interrupted blends preserve outgoing weights and do not mutate event history', () => {
  const m = machine(), e = [event(1, 'set', 'hovered', true), event(1.1, 'set', 'hovered', false)];
  const saved = JSON.stringify(e), at = core.sampleMachine(m, e, 1.1), after = core.sampleMachine(m, e, 1.2);
  assert.equal(JSON.stringify(e), saved);
  near(at.layers.find(l => l.state === 'curious').weight, .5);
  near(after.layers.find(l => l.state === 'curious').weight, .25);
  assert.equal(core.sampleMachine(m, e, 4).state, 'idle');
});

test('number inputs clamp, safe numeric conditions transition, wrong JS types fail', () => {
  const m = parse(source.replace('state curious when hovered', 'state curious when level >= 0.5')).interactive.machines[0];
  assert.equal(core.sampleMachine(m, [event(1, 'set', 'level', 5)], 2).inputs.level, 1);
  assert.equal(core.sampleMachine(m, [event(1, 'set', 'level', .7)], 2).state, 'curious');
  assert.equal(core.sampleMachine(m, [event(1, 'set', 'level', -.2)], 2).state, 'idle');
  assert.throws(() => core.inputValue(m.inputs[0], 'true'), /requires bool/);
  assert.throws(() => core.inputValue(m.inputs[2], NaN), /requires number/);
});

test('media plans are seek-synced across clip, scene and asset boundaries', () => {
  const assets = { s0: { duration: 2 } }, clips = [{ audio: 's0', at: 1, dur: 1.5, end: 2.5, volume: .3 }];
  assert.equal(core.mediaPlan(clips, assets, .5, true)[0].playing, false);
  assert.equal(core.mediaPlan(clips, assets, 1.5, true)[0].playing, true);
  const paused = core.mediaPlan(clips, assets, 1.75, false)[0]; near(paused.time, .75); assert.equal(paused.playing, false);
  const end = core.mediaPlan(clips, assets, 4, true)[0]; assert.equal(end.playing, false); near(end.time, 1.5);
});

test('actual generated interactive HTML executes API, hover, pointer, click, blending and deterministic seeks', () => {
  const page = loadPlayer(buildExample('examples/interactive/hoot.prism'));
  const { context: w, nodes } = page;
  const actor = nodes.find(n => n.dataset.orbCharacter === 'Hoot');
  assert.ok(actor); assert.equal(typeof w.orb.set, 'function');
  w.seek(1); actor.dispatch('pointerenter'); w.seek(1.4);
  const pose = () => JSON.stringify(nodes.filter(n => n.tagName !== 'audio').map(n => n.attributes));
  const hovered = pose();
  w.seek(.5); const idle = pose(); assert.notEqual(idle, hovered);
  w.seek(1.4); assert.equal(pose(), hovered);
  const svg = nodes.find(n => n.tagName === 'svg');
  svg.dispatch('pointermove', { clientX: 900, clientY: 150 }); const pointed = pose(); assert.notEqual(pointed, hovered);
  w.seek(2); actor.dispatch('click'); w.seek(2.4); const laugh = pose();
  w.seek(1.4); w.seek(2.4); assert.equal(pose(), laugh);
  w.orb.set('level', 5); w.orb.set('Hoot.level', .2); w.orb.fire('poke');
  assert.throws(() => w.orb.set('hovered', 'yes'), /requires bool/);
  assert.throws(() => w.orb.fire('hovered'), /requires orb.set/);
  assert.throws(() => w.orb.set('missing', true), /not declared/);
  actor.dispatch('pointerleave');
});

test('actual generated audio HTML pauses, seeks, plays and uses the embedded envelope for its jaw', () => {
  const { context: w, nodes, media, ids } = loadPlayer(buildExample('examples/cartoon/talk.prism'));
  assert.equal(media.length, 2);
  w.seek(.6); const jaw = nodes.find(n => n.attributes.fill === '#d9770a');
  const talking = jaw.attributes.transform;
  w.seek(.85); assert.equal(jaw.attributes.opacity, '0'); // silent gap in the source WAV
  w.seek(.6); assert.equal(jaw.attributes.transform, talking);
  near(media[0].currentTime, .1); assert.ok(media.every(m => m.paused));
  assert.equal(media[0].volume, .7); assert.equal(media[1].volume, 0);
  ids.play.onclick(); assert.ok(media.every(m => !m.paused));
  w.pause(); assert.ok(media.every(m => m.paused));
  w.seek(6); assert.ok(media.every(m => m.paused));
  w.seek(1); near(media[0].currentTime, .5);
});

test('state talk audio schedules local clips and state-local envelope seeking', () => {
  const src = source.replace('act laugh dur=1.2', 'act talk audio="../cartoon/assets/hoot-line.wav" dur=2.4');
  const html = compile(src, { baseDir: path.join(root, 'examples/interactive') });
  const { context: w, media } = loadPlayer(html);
  w.seek(1); w.orb.fire('poke'); w.seek(1.1);
  near(media[0].currentTime, .1); near(media[0].volume, .5);
  w.seek(1.4); near(media[0].currentTime, .4); near(media[0].volume, 1);
  w.seek(4); assert.ok(media.every(m => m.paused));
  w.seek(1.1); near(media.at(-1).currentTime, .1);
});

test('presentation controls still settle and advance in both legacy and enhanced pages', () => {
  for (const suffix of ['', '\n    audio "examples/cartoon/assets/hoot-line.wav" at=0 dur=0.5']) {
    const html = compile(`motion "Deck" 6s present=on\n  scene 3s\n    title "One"\n  scene 3s\n    title "Two"${suffix}`, { baseDir: root });
    const p = loadPlayer(html, ''); p.ids.play.onclick();
    assert.equal(p.context.__PRISM_PRESENT__().playing, false);
    p.key({ code: 'ArrowRight', preventDefault() {} });
    assert.equal(p.context.__PRISM_PRESENT__().cur, 1);
    p.ids.play.onclick(); assert.equal(p.context.__PRISM_PRESENT__().playing, false);
  }
});


test('generic names, input namespaces and looping state audio share deterministic local phases', () => {
  const renamed = source.replaceAll('Hoot', 'Pip').replace('state idle: act idle loop', 'state idle: act talk audio="../cartoon/assets/hoot-line.wav" dur=2.4 loop');
  const html = compile(renamed, { baseDir: path.join(root, 'examples/interactive') });
  const { context: w, media } = loadPlayer(html);
  assert.equal(w.__PRISM__.interactive.machines[0].who, 'Pip');
  w.seek(.1); const first = media[0].currentTime;
  w.seek(2.5); near(media[0].currentTime, first);
  w.orb.set('Pip.level', .8); w.orb.fire('Pip.poke');
  assert.throws(() => w.orb.set('Hoot.level', .2), /not declared/);
});
