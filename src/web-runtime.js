// Orb web player. This file is inlined into the page that `orb build file.orb --target web` writes.
// It plays a built Orb video in a plain browser page, with no other runtime:
//   1. mount: copy each composition's markup from its <template> into its host element;
//   2. time: show a clip only inside [start, start + duration), seek every GSAP timeline to its local time
//      (a composition's clock starts at its host's start) and keep video and audio on the same clock;
//   3. page: scale the stage to the window, a small control bar, and on window: seek(t), play(), pause() to
//      drive it, duration, currentTime and paused to read it.
//      ?controls=0 hides the bar (so does the class "nocontrols" on <body>), ?t=2 opens paused at 2 s, ?loop=1 repeats.
// The picture is a function of the time alone: seek(t) shows the same frame whatever was shown before.
(function () {
  'use strict';
  const stage = document.getElementById('root');
  const W = Number(stage.dataset.width), H = Number(stage.dataset.height), duration = Number(stage.dataset.duration);
  const query = new URLSearchParams(location.search);
  const loop = query.get('loop') === '1', BAR = 56;
  if (query.get('controls') === '0') document.body.classList.add('nocontrols');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const json = text => { try { return JSON.parse(text); } catch { return null; } };

  // ---------- variables ----------
  // A file declares its variables as [{id, default}]; a host can set values for its own mount.
  const declared = el => Object.fromEntries((json(el.getAttribute('data-composition-variables')) || []).map(v => [v.id, v.default]));
  const variables = { '': declared(document.documentElement) };
  let running = '';   // id of the composition whose script is running, so getVariables() answers for it

  // ---------- what a composition's code expects from the page ----------
  // The timeline registry, and two helpers that compositions written for the video renderer may call.
  const ruler = document.createElement('canvas').getContext('2d');
  window.__timelines = window.__timelines || {};
  window.__hyperframes = {
    // The largest font size, counting down from baseFontSize, at which the text fits on one line of maxWidth.
    fitTextFontSize(text, options) {
      const o = { maxWidth: 1600, baseFontSize: 78, minFontSize: 42, fontWeight: 900, fontFamily: 'Outfit', step: 2, ...options };
      const line = String(text).replace(/\s+/g, ' ').trim();
      for (let size = o.baseFontSize; ; size = Math.max(o.minFontSize, size - o.step)) {
        ruler.font = `${o.fontWeight} ${size}px ${o.fontFamily}`;
        if (ruler.measureText(line).width <= o.maxWidth + .005) return { fontSize: size, fits: true };
        if (size <= o.minFontSize) return { fontSize: o.minFontSize, fits: false };
      }
    },
    getVariables: () => ({ ...variables[running] }),
  };

  // ---------- mount ----------
  // Embedded media files are stored once, in a table; elements name theirs in data-orb-src. A page built without
  // the table gets its URLs later, from the page that shows it, through __orb.media().
  const assets = json(document.getElementById('orb-assets')?.textContent) || {};
  const link = scope => { for (const el of scope.querySelectorAll('[data-orb-src]')) if (assets[el.dataset.orbSrc]) el.src = assets[el.dataset.orbSrc]; };
  function mount(scope) {
    for (const host of scope.querySelectorAll('[data-composition-src]')) {
      const id = host.getAttribute('data-composition-id');
      const template = document.querySelector(`template[data-orb-composition="${CSS.escape(host.getAttribute('data-composition-src'))}"]`);
      if (!template) continue;
      host.replaceChildren(template.content.cloneNode(true));
      link(host);
      const inner = host.querySelector('#root');
      if (inner) {
        // The composition's own root becomes an anonymous box: its id and its timing now belong to the host.
        variables[id] = { ...declared(inner), ...json(host.getAttribute('data-variable-values')) };
        for (const name of ['id', 'data-composition-id', 'data-start', 'data-duration']) inner.removeAttribute(name);
        inner.setAttribute('data-orb-root', '');
        for (const box of [host, inner]) {
          if (inner.dataset.width) box.style.width = inner.dataset.width + 'px';
          if (inner.dataset.height) box.style.height = inner.dataset.height + 'px';
        }
        for (const [name, value] of Object.entries(variables[id])) {
          host.style.setProperty('--' + name, String(value));
          for (const el of host.querySelectorAll(`[data-var-text="${CSS.escape(name)}"]`)) el.textContent = value;
          for (const el of host.querySelectorAll(`[data-var-src="${CSS.escape(name)}"]`)) el.setAttribute('src', value);
        }
      }
      mount(host);
    }
  }

  // Each composition's script arrives wrapped in its own function (they all declare `const tl`) and runs once the
  // fonts are in, outer compositions first.
  const scripts = new Map();
  window.__orb = {
    composition(id, run) { scripts.set(id, [...(scripts.get(id) || []), run]); },
    media(urls) { Object.assign(assets, urls); link(document); },
  };
  function runScripts() {
    for (const host of stage.querySelectorAll('[data-composition-id]')) {
      for (const run of scripts.get(host.getAttribute('data-composition-id')) || []) {
        running = host.getAttribute('data-composition-id');
        try { run(); } catch (error) { console.error(`orb: composition "${running}" failed:`, error); }
        running = '';
      }
    }
  }

  // ---------- time ----------
  // A clip's data-start counts from the composition that holds it, even when it sits inside another timed element.
  const holder = el => el.parentElement.closest('[data-composition-id]');
  const startOf = el => el === stage ? 0 : startOf(holder(el)) + (Number(el.dataset.start) || 0);
  let clips = [], timelines = [], media = [], shown = new Set();

  function index() {
    clips = [...stage.querySelectorAll('[data-start]')].map(el => {
      const start = startOf(el), length = el.dataset.duration;
      return { el, start, end: length === undefined ? Infinity : start + Number(length), parent: el.parentElement.closest('[data-start]') };
    });
    media = clips.filter(clip => clip.el.matches('video, audio'));
    timelines = Object.entries(window.__timelines).flatMap(([id, timeline]) => {
      const host = id === stage.dataset.compositionId ? stage : stage.querySelector(`[data-composition-id="${CSS.escape(id)}"]`);
      return host && timeline && timeline.totalTime ? [{ timeline, start: startOf(host) }] : [];
    });
    // Play every timeline through once. A tween that has never run leaves the page as it was written, one that
    // has run and is rewound leaves its start values; after this pass only the second case exists.
    for (const { timeline } of timelines) timeline.totalTime(timeline.totalDuration(), true).totalTime(0, true);
  }

  function render(t) {
    shown = new Set([stage]);
    for (const clip of clips) {
      const on = t >= clip.start && t < clip.end && shown.has(clip.parent);
      if (on) shown.add(clip.el);
      clip.el.style.visibility = on ? '' : 'hidden';   // hidden clips keep their layout, so text fitting still measures them
    }
    for (const { timeline, start } of timelines) timeline.totalTime(Math.max(0, t - start), true);
    // Canvas and 3D compositions draw from this event.
    window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time: t, waitUntil() {} } }));
  }

  // ---------- video and audio ----------
  let blocked = false;   // the browser refused sound before the first click or key press
  function gain(clip, local) {
    const d = clip.el.dataset, bus = document.getElementById(d.audioGroup);   // <hf-audio-group id="music" data-volume=".07">
    const fadeIn = Number(d.fadeIn) || 0, fadeOut = Number(d.fadeOut) || 0;
    const fade = Math.min(1, fadeIn ? local / fadeIn : 1, fadeOut ? (clip.end - clip.start - local) / fadeOut : 1);
    return clamp((bus ? Number(bus.dataset.volume) : 1) * Number(d.volume ?? 1) * fade, 0, 1);
  }
  // Move a paused element to `at`; resolves when that frame is on screen.
  function settle(el, at) {
    return new Promise(done => {
      const go = () => {
        if (Math.abs(el.currentTime - at) < .001 && el.readyState >= 2) return done();
        el.addEventListener('seeked', done, { once: true });
        el.currentTime = at;
      };
      if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
      setTimeout(done, 2000);
    });
  }
  function syncMedia(t) {
    const waits = [];
    for (const clip of media) {
      const el = clip.el, rate = Number(el.dataset.playbackRate) || 1;
      const at = (Number(el.dataset.mediaStart) || 0) + (t - clip.start) * rate;
      if (!shown.has(el)) { if (!el.paused) el.pause(); continue; }
      el.volume = gain(clip, t - clip.start);
      if (playing) {
        el.playbackRate = rate;
        if (Math.abs(el.currentTime - at) > .3) el.currentTime = at;
        if (el.paused && (el.muted || !blocked)) el.play().catch(error => { if (error.name === 'NotAllowedError') blocked = true; });
      } else {
        if (!el.paused) el.pause();
        if (el.tagName === 'VIDEO') waits.push(settle(el, at));
      }
    }
    return Promise.all(waits);
  }

  // ---------- clock ----------
  let time = 0, playing = false, last = null, bar = null;
  function show(t) {
    time = clamp(Number(t) || 0, 0, duration);
    render(Math.min(time, duration - 1e-6));   // the last instant keeps the last frame instead of an empty stage
    if (bar) {
      bar.button.textContent = playing ? 'Pause' : 'Play';
      bar.scrub.value = 1000 * time / duration;
      bar.clock.textContent = `${time.toFixed(1)} / ${duration.toFixed(1)}s`;
    }
    return syncMedia(Math.min(time, duration - 1e-6));
  }
  function tick(now) {
    if (playing && last !== null) {
      let next = time + Math.min((now - last) / 1000, .1);   // a stalled frame never makes the clock jump
      if (next >= duration) { if (loop) next = 0; else { next = duration; playing = false; } }
      show(next);
    }
    last = playing ? now : null;
    requestAnimationFrame(tick);
  }
  const seek = t => { playing = false; return show(t).then(() => {}); };
  const play = () => { if (time >= duration) time = 0; playing = true; show(time); };
  const pause = () => seek(time);

  // ---------- page ----------
  function fit() {
    const room = innerHeight - (document.body.classList.contains('nocontrols') ? 0 : BAR), k = Math.min(innerWidth / W, room / H);
    const x = (innerWidth - W * k) / 2, y = (room - H * k) / 2;
    stage.style.transform = k === 1 && !x && !y ? '' : `translate(${x}px,${y}px) scale(${k})`;
  }
  function note(text) {
    const box = document.body.appendChild(document.createElement('div'));
    box.id = 'orb-note'; box.textContent = text;
  }
  function addControls() {
    const box = document.body.appendChild(document.createElement('div'));
    box.id = 'orb-bar';
    box.innerHTML = '<button type="button" aria-label="Play or pause">Play</button><input type="range" min="0" max="1000" value="0" aria-label="Timeline"><span></span>';
    bar = { button: box.children[0], scrub: box.children[1], clock: box.children[2] };
    bar.button.onclick = () => playing ? pause() : play();
    bar.scrub.oninput = () => seek(duration * bar.scrub.value / 1000);
  }
  document.head.appendChild(document.createElement('style')).textContent = `
html,body{overflow:hidden}
#root{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
#orb-bar{position:fixed;left:0;right:0;bottom:0;height:${BAR}px;display:flex;align-items:center;gap:12px;padding:0 16px;background:#0e1220;border-top:1px solid #222a40;font:16px/1.3 system-ui,sans-serif}
.nocontrols #orb-bar{display:none}
#orb-bar button{min-width:76px;padding:6px 14px;background:#1b2340;color:#e8ebff;border:1px solid #2c3658;border-radius:8px;font:inherit;cursor:pointer}
#orb-bar button:hover{border-color:#6ea8ff}
#orb-bar input{flex:1;accent-color:#6ea8ff}
#orb-bar span{min-width:100px;color:#8e98c0;font-variant-numeric:tabular-nums;text-align:right}
#orb-note{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0f1a;color:#e8ebff;font:18px/1.5 system-ui,sans-serif;text-align:center}`;

  async function start() {
    if (!window.gsap) return note('The animation library (GSAP) did not load. Check the network connection, then reload.');
    // Scripts measure text, so the fonts come first. Reading a size makes the browser ask for the faces in use.
    void document.body.offsetHeight;
    await Promise.race([document.fonts.ready, new Promise(done => setTimeout(done, 5000))]);
    runScripts();
    if (typeof window.fitOrbText === 'function') window.fitOrbText();   // the compiler's text fitting, now that every piece is in place
    index();
    addControls();
    fit();
    addEventListener('resize', fit);
    addEventListener('keydown', event => {
      blocked = false;
      if (event.code === 'Space' && event.target.tagName !== 'INPUT') { event.preventDefault(); playing ? pause() : play(); }
    });
    addEventListener('pointerdown', () => { blocked = false; });
    Object.assign(window, { seek, play, pause, duration });
    Object.defineProperties(window, { currentTime: { get: () => time }, paused: { get: () => !playing } });
    if (query.has('t')) seek(parseFloat(query.get('t'))); else play();
    requestAnimationFrame(tick);
  }

  link(stage);
  mount(stage);   // before the main composition's script, which follows this one in the page
  document.addEventListener('DOMContentLoaded', start);
})();
