// Shared pure functions: the browser embeds this same factory; Node tests call it directly.
function createPlayerCore() {
  const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
  function condition(c, inputs) {
    let v = inputs[c.input];
    if (c.op) v = ({ '>': () => v > c.value, '<': () => v < c.value, '>=': () => v >= c.value, '<=': () => v <= c.value, '==': () => v === c.value, '!=': () => v !== c.value })[c.op]();
    return c.negate ? !v : !!v;
  }
  function inputValue(input, value) {
    if (input.kind === 'bool' && typeof value === 'boolean') return value;
    if (input.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) return clamp(value, input.min, input.max);
    throw new TypeError(`${input.name} requires ${input.kind === 'trigger' ? 'orb.fire(name)' : input.kind}`);
  }
  function sampleMachine(machine, events, time) {
    const states = machine.states, byName = Object.fromEntries(states.map(s => [s.name, s]));
    const fallback = states.find(s => !s.condition);
    const inputs = Object.fromEntries(machine.inputs.map(i => [i.name, i.kind === 'number' ? clamp(0, i.min, i.max) : false]));
    let current = { state: fallback.name, start: 0 }, previous = [], blend = 0, pointer = [0, 0];
    const layers = t => {
      const w = blend > 0 ? clamp((t - current.start) / blend) : 1;
      return [...previous.map(l => ({ ...l, weight: l.weight * (1 - w) })), { ...current, weight: w }].filter(l => l.weight > 0);
    };
    function enter(state, at) {
      previous = layers(at);
      current = { state: state.name, start: at };
      blend = state.blend ?? machine.blend;
    }
    function desired() { return states.find(s => s.condition?.mode === 'when' && condition(s.condition, inputs)) || fallback; }
    function advance(to) {
      // Every automatic return has a strictly positive duration; cap pathological authored cycles.
      for (let guard = 0; guard < 10000; guard++) {
        const s = byName[current.state], end = current.start + s.duration;
        if (!(s.next || s.condition?.mode === 'on') || s.actions.some(a => a.loop) || end > to) return;
        enter(s.next ? byName[s.next] : desired(), end);
      }
      throw new Error('machine exceeded 10000 automatic transitions');
    }
    const initial = desired();
    if (initial.name !== current.state) enter(initial, 0);
    for (const event of events.map((e, i) => ({ ...e, order: i })).filter(e => e.at >= 0 && e.at <= time).sort((a, b) => a.at - b.at || a.order - b.order)) {
      advance(event.at);
      if (event.kind === 'pointer') { pointer = event.value; continue; }
      const input = machine.inputs.find(i => i.name === event.name);
      if (!input) continue;
      if (event.kind === 'fire') {
        const next = states.find(s => s.condition?.mode === 'on' && s.condition.input === event.name);
        if (next) enter(next, event.at); // repeated triggers deliberately restart the state's local clock
      } else {
        inputs[event.name] = inputValue(input, event.value);
        if (byName[current.state].condition?.mode !== 'on') {
          const next = desired(); if (next.name !== current.state) enter(next, event.at);
        }
      }
    }
    advance(time);
    return { state: current.state, start: current.start, inputs, pointer, layers: layers(time) };
  }
  function envelope(asset, time) {
    if (time < 0 || time >= asset.duration) return 0;
    return (asset.samples[Math.floor(time * asset.fps)] || 0) / 255;
  }
  function syllables(text, time, duration, seed = 0) {
    if (time < 0 || time >= duration || !text.trim()) return 0;
    let h = seed >>> 0; for (const c of text) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
    const units = text.match(/[aeiouy]+|[^\s.,!?;:]+[.,!?;:]?/gi) || [text];
    const index = Math.floor(time / duration * units.length * 2.4);
    const noise = (Math.imul(index + 1, 1664525) + h + 1013904223) >>> 0;
    const rate = 4.1 + (noise % 170) / 100;
    const beat = time * 5.2 + (h % 31) / 31;
    const pulse = Math.pow(Math.max(0, Math.sin(beat * Math.PI * 2)), 0.7);
    const pause = noise % 9 === 0 ? 0 : 1;
    return pulse * pause * (0.55 + (noise % 45) / 100) * Math.min(1, time * rate * 3, (duration - time) * 12);
  }
  function pose(base, moods, actions, time, pointer, seed, unit, assets, stateTimeline = false) {
    const ease = x => 1 - Math.pow(1 - clamp(x), 3);
    let cur = { ...base };
    const clock = a => a.loop && time >= a.at ? (time - a.at) % a.dur : time - a.at;
    for (const a of actions.filter(a => a.verb === 'feel').sort((a, b) => a.at - b.at)) if (time >= a.at) {
      const k = ease(clock(a) / a.dur), target = moods[a.to || 'neutral'];
      for (const key of Object.keys(cur)) cur[key] += (target[key] - cur[key]) * k;
    }
    const ph = time * 2.2 + seed;
    const p = { cur, jy: 0, sx: 1, sy: 1 + 0.012 * Math.sin(ph) - 0.05 * cur.droop, rot: 0,
      wl: 0.12 + cur.wing * 0.9, wr: -0.12 - cur.wing * 0.9, open: cur.open,
      px: 4 * Math.sin(time * 0.7 + seed), py: 3 * Math.sin(time * 0.5) + 8 * cur.droop,
      squint: cur.squint, brow: cur.brow, browY: cur.browY, confK: -1 };
    const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], forward: [0, 0] };
    let follows = false;
    for (const a of actions) {
      if (a.verb === 'feel') continue;
      const local = clock(a), raw = local / a.dur;
      if (raw < 0 || (!stateTimeline && raw > 1)) continue;
      const k = clamp(raw), w = stateTimeline && a.verb === 'look' ? 1 : Math.sin(Math.PI * k);
      if (a.verb === 'wave') p.wr = -2.4 * w + 0.35 * Math.sin(time * 12) * w;
      if (a.verb === 'talk') {
        p.open = a.audio ? envelope(assets[a.audio], local) : a.text !== undefined ? syllables(a.text, local, a.dur, seed * 1000) : Math.max(p.open, Math.abs(Math.sin(time * 11)) * w);
        p.rot = 0.03 * Math.sin(time * 2.4) * w; p.wr = -0.5 * w;
      }
      if (a.verb === 'nod') p.py += 10 * Math.sin(time * 8) * w;
      if (a.verb === 'look') { const d = a.to === 'pointer' ? pointer : dirs[a.to] || [0, 0]; p.px += d[0] * 17 * w; p.py += d[1] * 15 * w; p.rot += d[0] * 0.07 * w; follows ||= a.to === 'pointer'; }
      if (a.verb === 'hop') { p.jy = -90 * unit * Math.sin(Math.PI * k); p.sy = 1 + 0.12 * Math.sin(Math.PI * k); p.sx = 1 / p.sy; }
      if (a.verb === 'cheer') { const hop = raw <= 1 ? Math.abs(Math.sin(Math.PI * k * 2.2)) : 0; p.jy = -120 * unit * hop; p.sy = 1 + 0.14 * hop - (hop < 0.12 ? 0.18 : 0); p.sx = 1 / p.sy; p.wl = -2.5 * w; p.wr = 2.5 * w; p.open = 0.85 * w; p.squint = Math.max(p.squint, w); p.brow = -0.3 * w; p.confK = raw <= 1 ? k : -1; }
      if (a.verb === 'laugh') { p.jy = -14 * unit * Math.abs(Math.sin(time * 13)) * w; p.squint = Math.max(p.squint, w); p.open = Math.max(p.open, 0.8 * w); }
      if (a.verb === 'sad') { p.sy = 1 - 0.07 * w; p.wl = 0.12 + 0.5 * w; p.wr = -0.12 - 0.5 * w; p.brow = 0.4 * w; p.py += 12 * w; }
    }
    if (!follows) { p.px += pointer[0] * 17; p.py += pointer[1] * 15; p.rot += pointer[0] * 0.07; }
    return p;
  }
  function mixPoses(layers) {
    const result = { cur: {} };
    for (const { value, weight } of layers) {
      for (const key of Object.keys(value)) if (key !== 'cur') result[key] = (result[key] || 0) + value[key] * weight;
      for (const key of Object.keys(value.cur)) result.cur[key] = (result.cur[key] || 0) + value.cur[key] * weight;
    }
    return result;
  }
  function mediaPlan(clips, assets, time, playing) {
    return clips.map(c => {
      const local = time - c.at, asset = assets[c.audio];
      const active = local >= 0 && time < c.end && local < asset.duration;
      return { ...c, time: clamp(local, 0, Math.min(c.dur, asset.duration)), playing: playing && active, volume: c.volume ?? 1 };
    });
  }
  return { sampleMachine, condition, inputValue, envelope, syllables, mediaPlan, pose, mixPoses };
}
module.exports = { createPlayerCore, ...createPlayerCore() };
