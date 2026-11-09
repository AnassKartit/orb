// The two functions in this file run inside the preview page, not in the playground: the playground adds their
// source to each page it shows. The preview is a sandboxed frame the playground cannot reach into, so they talk
// to it with postMessage.

// Added to every preview. It fetches the page's media from the playground, takes over the clock of the page it
// replaces, reports its own clock, loops the piece, passes on keys, clicks and drops, and (video pages) lets the
// visitor select an item, move it and resize it.
//   id    the number of this page; every message carries it
//   from  { time, playing, slide, stamp } of the page being replaced, or null to start at 0
//   edit  { ids, select }: the items that may be moved, and the one to select once the page is up
function orbPreviewBridge(id, from, edit) {
  const tell = message => parent.postMessage({ orb: id, ...message }, '*');
  const scenes = window.__PRISM_PRESENT__, slideshow = () => document.body.classList.contains('present');
  const state = () => scenes ? { time: scenes().t, playing: scenes().playing, slide: scenes().cur } : { time: window.currentTime, playing: !window.paused, slide: 0 };
  const key = code => dispatchEvent(new KeyboardEvent('keydown', { code }));
  const at = () => from.time + (from.playing ? (Date.now() - from.stamp) / 1000 : 0);   // the old page's clock, now

  async function begin() {
    if (typeof window.seek !== 'function') return setTimeout(begin, 30);
    for (const note of document.querySelectorAll('.hint')) note.remove();   // the playground shows its own
    if (from && slideshow()) for (let k = 0; k < 1 + 2 * from.slide; k++) key('ArrowRight');   // per slide: one key starts its build, one finishes it
    else if (from && scenes) { if (!from.playing) window.pause(); window.seek(at()); }
    else if (from) {
      await window.seek(at());   // paused: resolves when video frames are in
      window.seek(at());
      if (from.playing && at() < window.duration) window.play();
    }
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    await new Promise(done => { requestAnimationFrame(() => requestAnimationFrame(done)); setTimeout(done, 150); });
    if (edit.select) pick(edit.select, true);
    tell({ ready: true, stamp: Date.now(), ...state() });
    let ended = 0;
    setInterval(() => {
      const here = state(), length = window.duration || window.__PRISM_DURATION__;
      tell({ stamp: Date.now(), ...here });
      // A piece that has played to its end holds its last frame for a moment, then starts again.
      if (slideshow() || drag || here.playing || here.time < length - .05) { ended = 0; return; }
      ended = ended || Date.now();
      if (Date.now() - ended < 1500) return;
      ended = 0;
      window.seek(0);
      if (typeof window.play === 'function') window.play(); else document.getElementById('play').click();
    }, 100);
  }

  // ---------- select, move, resize ----------
  // The item's box is the element that carries left, top, width and height: for a picture or a video, its wrapper.
  // A ring with eight handles follows it on screen. While a drag lasts the piece is paused and the box is changed
  // right here, so it follows the pointer; each step is also sent to the playground, which rewrites box= in the source.
  const stage = document.getElementById('root'), movable = new Set(edit.ids);
  const boxOf = name => { const el = document.getElementById(name); return el && /^(IMG|VIDEO)$/.test(el.tagName) ? document.getElementById(name + '-motion') : el; };
  let picked = null, drag = null, ring = null;
  function pick(name, quiet) {
    picked = name && movable.has(name) && boxOf(name) ? name : null;
    if (!quiet) tell({ picked });
  }
  function grab(event, edge) {
    const el = boxOf(picked);
    drag = { edge, x: event.clientX, y: event.clientY, scale: stage.getBoundingClientRect().width / stage.offsetWidth, box: [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight], playing: !window.paused, moved: false };
    stage.setPointerCapture(event.pointerId);   // the stage hears the rest of the drag, wherever the pointer goes
    window.pause();
    event.preventDefault();   // no text selection and no picture drag while the item moves
    window.focus();           // which also stops the click from moving the focus here, so take it
  }
  function move(event) {
    if (!drag) return;
    const dx = (event.clientX - drag.x) / drag.scale, dy = (event.clientY - drag.y) / drag.scale, edge = drag.edge;
    if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3) return;   // still a click
    let [x, y, w, h] = drag.box;
    if (edge === 'move') { x += dx; y += dy; }
    else {
      if (edge.includes('e')) w = Math.max(10, w + dx);
      if (edge.includes('s')) h = Math.max(10, h + dy);
      if (edge.includes('w')) { w = Math.max(10, w - dx); x = drag.box[0] + drag.box[2] - w; }
      if (edge.includes('n')) { h = Math.max(10, h - dy); y = drag.box[1] + drag.box[3] - h; }
    }
    drag.moved = true;
    drag.now = [x, y, w, h].map(Math.round);
    Object.assign(boxOf(picked).style, { left: drag.now[0] + 'px', top: drag.now[1] + 'px', width: drag.now[2] + 'px', height: drag.now[3] + 'px' });
    if (typeof window.fitOrbText === 'function') window.fitOrbText();
    tell({ item: picked, box: drag.now });
  }
  function release() {
    if (!drag) return;
    const done = drag;
    drag = null;
    if (done.moved) tell({ item: picked, box: done.now, done: true, resume: done.playing });   // the playground rebuilds from the new source
    else if (done.playing) window.play();
  }
  if (stage && window.__orb && movable.size) {
    document.head.appendChild(document.createElement('style')).textContent = '#orb-pick{position:fixed;z-index:2147483646;box-sizing:border-box;border:2px solid #6ea8ff;cursor:move;touch-action:none}'
      + '#orb-pick i{position:absolute;width:12px;height:12px;margin:-7px;background:#fff;border:2px solid #6ea8ff;border-radius:50%}';
    ring = document.body.appendChild(document.createElement('div'));
    ring.id = 'orb-pick';
    ring.hidden = true;
    for (const [edge, left, top] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['e', 100, 50], ['se', 100, 100], ['s', 50, 100], ['sw', 0, 100], ['w', 0, 50]]) {
      const handle = ring.appendChild(document.createElement('i'));
      handle.dataset.edge = edge;
      handle.style.cssText = `left:${left}%;top:${top}%;cursor:${edge}-resize`;
    }
    ring.addEventListener('pointerdown', event => grab(event, event.target.dataset.edge || 'move'));
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerdown', event => {   // the innermost movable item under the pointer, or none
      let el = event.target;
      while (el && el !== stage && !movable.has(el.id.replace(/-motion$/, ''))) el = el.parentElement;
      pick(el && el !== stage ? el.id.replace(/-motion$/, '') : null);
      if (picked) grab(event, 'move');
    });
    (function follow() {
      const el = picked && boxOf(picked);
      ring.hidden = !el || getComputedStyle(el).visibility === 'hidden';
      if (el) { const r = el.getBoundingClientRect(); Object.assign(ring.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); }
      requestAnimationFrame(follow);
    })();
  }

  addEventListener('message', event => {
    const data = event.data || {};
    if (data.orbKey) key(data.orbKey);
    if ('orbSelect' in data) pick(data.orbSelect, true);
    if (!data.orbMedia) return;
    if (window.__orb) window.__orb.media(Object.fromEntries(Object.entries(data.orbMedia).map(([name, blob]) => [name, URL.createObjectURL(blob)])));
    begin();
  });
  addEventListener('pointerdown', () => tell({ clicked: true }));
  addEventListener('dragover', event => event.preventDefault());
  addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer.files[0]) tell({ drop: event.dataTransfer.files[0] }); });
  tell({ hello: true });
}

// Added to the preview while recording. It hides the control bar, waits at 0 and plays once when told to. A video
// page keeps its own clock (and its sound); a page with scenes is stepped from here.
function orbRecordDriver() {
  if (typeof window.seek !== 'function') return setTimeout(orbRecordDriver, 50);
  document.body.classList.add('nocontrols');
  dispatchEvent(new Event('resize'));
  window.pause();
  window.seek(0);
  addEventListener('message', event => {
    if (event.data !== 'orb-record-go') return;
    if (typeof window.play === 'function') return window.play();   // a page with scenes has no play(), only a Play button
    const start = performance.now();
    (function step() { window.seek((performance.now() - start) / 1000); requestAnimationFrame(step); })();
  });
  parent.postMessage('orb-record-ready', '*');
}
