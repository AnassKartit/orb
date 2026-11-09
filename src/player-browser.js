// Browser adapter. Event history is data; state/pose sampling never depends on frame rate.
function createPlayerBrowser(M, core, now, redraw) {
  const machines = M.interactive?.machines || [], bindings = M.interactive?.bindings || [];
  const assets = M.audioAssets || {}, histories = new Map(), pointers = new Map(), snapshots = new Map(), media = new Map();
  let currentTime = 0;
  for (const asset of Object.values(assets)) asset.samples = Uint8Array.from(atob(asset.envelope), c => c.charCodeAt(0));
  const history = m => { if (!histories.has(m)) histories.set(m, []); return histories.get(m); };
  const active = m => now() >= m.start && now() < m.end;
  function resolve(name) {
    const matches = machines.flatMap(m => m.inputs.filter(i => name === i.name || name === `${m.who}.${i.name}`).map(i => ({ m, i })));
    const live = matches.filter(({ m }) => active(m)), list = live.length ? live : matches;
    if (list.length !== 1) throw new Error(`input '${name}' ${list.length ? 'is ambiguous; use Character.input' : 'was not declared'}`);
    return list[0];
  }
  function record(m, event) {
    history(m).push({ ...event, at: Math.max(0, now() - m.start) });
  }
  function set(name, value) { const { m, i } = resolve(name); record(m, { kind: 'set', name: i.name, value: core.inputValue(i, value) }); redraw(); }
  function fire(name) { const { m, i } = resolve(name); if (i.kind !== 'trigger') throw new TypeError(`${name} requires orb.set(name, value)`); record(m, { kind: 'fire', name: i.name }); redraw(); }
  window.orb = { set, fire };
  function bind(who, node, scene, surface) {
    node.dataset.orbCharacter = who;
    const relevant = bindings.filter(b => b.who === who && b.scene === scene);
    const machine = machines.find(m => m.who === who && m.scene === scene);
    const send = (b, kind, value) => { if (machine && active(machine)) { record(machine, { kind, name: b.input, value }); redraw(); } };
    for (const b of relevant) {
      if (b.event === 'hover') { node.addEventListener('pointerenter', () => send(b, 'set', true)); node.addEventListener('pointerleave', () => send(b, 'set', false)); }
      if (b.event === 'click') { node.style.cursor = 'pointer'; node.addEventListener('click', () => send(b, 'fire')); }
      if (b.event === 'pointer') surface.addEventListener('pointermove', e => {
        if (now() < M.scenes[scene].start || now() >= M.scenes[scene].end) return;
        const rect = node.getBoundingClientRect();
        const value = [Math.max(-1, Math.min(1, (e.clientX - rect.left - rect.width / 2) / Math.max(1, rect.width))), Math.max(-1, Math.min(1, (e.clientY - rect.top - rect.height / 2) / Math.max(1, rect.height)))];
        const key = `${scene}:${who}`;
        if (!pointers.has(key)) pointers.set(key, []);
        pointers.get(key).push({ at: now(), value });
        if (machine) record(machine, { kind: 'pointer', value });
        redraw();
      });
    }
  }
  function pointer(who, scene) {
    const events = pointers.get(`${scene}:${who}`) || [];
    return events.filter(e => e.at <= currentTime).sort((a, b) => a.at - b.at).at(-1)?.value || [0, 0];
  }
  function update(time, playing, force = false) {
    currentTime = time;
    const clips = (M.audioClips || []).map((c, i) => ({ ...c, key: `clip:${i}` }));
    machines.forEach((m, i) => {
      const sample = core.sampleMachine(m, history(m), Math.max(0, time - m.start)); snapshots.set(m, sample);
      if (time < m.start || time >= m.end) return;
      for (const layer of sample.layers) {
        const state = m.states.find(s => s.name === layer.state);
        state.actions.forEach((a, j) => {
          if (!a.audio) return;
          const elapsed = time - m.start - layer.start - a.at;
          const cycle = a.loop ? Math.max(0, Math.floor(elapsed / a.dur)) : 0;
          const at = m.start + layer.start + a.at + cycle * a.dur;
          clips.push({ audio: a.audio, at, dur: a.dur, end: Math.min(m.end, at + a.dur), volume: Number(a.named.volume ?? 1) * layer.weight, key: `machine:${i}:${layer.state}:${layer.start}:${j}` });
        });
      }
    });
    const wanted = new Set();
    for (const c of core.mediaPlan(clips, assets, time, playing)) {
      wanted.add(c.key);
      let audio = media.get(c.key);
      if (!audio) { audio = document.createElement('audio'); audio.src = assets[c.audio].src; audio.preload = 'auto'; media.set(c.key, audio); }
      audio.volume = Math.min(1, Math.max(0, c.volume));
      // A paused seek is exact. During play, correct meaningful drift without seeking every frame.
      if (force || !c.playing || Math.abs(audio.currentTime - c.time) > 0.1) {
        try { audio.currentTime = c.time; } catch (_) { /* metadata may still be loading; retry on the next update */ }
      }
      if (c.playing && audio.paused) { const result = audio.play(); if (result?.catch) result.catch(() => {}); }
      else if (!c.playing) audio.pause();
    }
    for (const [key, audio] of media) if (!wanted.has(key)) { audio.pause(); audio.removeAttribute('src'); audio.load(); media.delete(key); }
  }
  function pose(timeline, who, scene, time, base, moods, seed, unit) {
    const ptr = pointer(who, scene);
    const machine = machines.find(m => m.who === who && m.scene === scene);
    const sample = machine && snapshots.get(machine);
    if (!sample || currentTime < machine.start) return core.pose(base, moods, timeline.filter(a => a.who === who), time, ptr, seed, unit, assets);
    return core.mixPoses(sample.layers.map(layer => {
      const state = machine.states.find(s => s.name === layer.state);
      const actions = state.actions.map(a => ({ verb: a.args[0], to: a.named.to, text: a.named.text, audio: a.audio, at: a.at, dur: a.dur, loop: a.loop }));
      return { weight: layer.weight, value: core.pose(base, moods, actions, currentTime - machine.start - layer.start, ptr, seed, unit, assets, true) };
    }));
  }
  function mouth(a, time) { return a.audio ? core.envelope(assets[a.audio], time - a.at) : core.syllables(a.text, time - a.at, a.dur); }
  return { bind, update, pose, mouth, pointer };
}
module.exports = { createPlayerBrowser };
