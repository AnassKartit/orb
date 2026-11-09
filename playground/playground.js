// Orb playground: source on the left, the playing result on the right, all in this page.
// orb-compiler.js is the compiler the command line uses, bundled for the browser by scripts/build-playground.js:
// Orb.preview(source) returns a page for either kind of file. lessons.js holds the steps of Learn Orb.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const source = $('source'), gutter = $('gutter'), mark = $('mark'), expanded = $('expanded'), samples = $('samples');
  const palette = $('palette'), swatches = $('swatches'), chips = $('chips'), hint = $('hint');

  if (typeof Orb === 'undefined') {
    $('problem').hidden = false;
    $('problem-text').textContent = 'orb-compiler.js is missing. Create it with: node scripts/build-playground.js';
    return;
  }

  // Copy text and say so. Where the clipboard is not allowed, `otherwise` runs and names what happened instead.
  async function copy(text, status, otherwise) {
    try { await navigator.clipboard.writeText(text); status.textContent = 'Copied'; }
    catch { status.textContent = otherwise(); }
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
  for (const button of document.querySelectorAll('[data-copy]')) {
    const block = $(button.dataset.copy);
    button.onclick = () => copy(block.textContent, $('agent-status'), () => { getSelection().selectAllChildren(block); return 'Selected: press Ctrl+C or Cmd+C'; });
  }

  // ---------- share link: the source travels in the URL hash ----------
  const encode = text => btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = code => new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  function fromHash() {
    const match = location.hash.match(/^#src=(.+)$/);
    if (!match) return null;
    try { return decode(match[1]); } catch { return null; }
  }
  $('share').onclick = () => {
    history.replaceState(null, '', '#src=' + encode(source.value));
    copy(location.href, $('shared'), () => 'Link is in the address bar');
  };

  // ---------- editor ----------
  let errorLine = 0;
  const placeMark = () => { mark.hidden = !errorLine; mark.style.top = `${12 + (errorLine - 1) * 20 - source.scrollTop}px`; };   // 12 px padding, 20 px lines
  function drawGutter() {
    const count = source.value.split('\n').length;
    gutter.innerHTML = Array.from({ length: count }, (_, i) => i + 1 === errorLine ? `<b>${i + 1}</b>` : i + 1).join('\n');
    gutter.scrollTop = source.scrollTop;
    placeMark();
  }
  source.addEventListener('scroll', () => { gutter.scrollTop = source.scrollTop; placeMark(); });
  source.addEventListener('keydown', event => {   // Tab indents by one level, which is two spaces in Orb
    if (event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
    source.dispatchEvent(new Event('input'));
  });
  function selectLine(index, caretOnly) {
    const lines = source.value.split('\n'), start = lines.slice(0, index).join('\n').length + (index ? 1 : 0), end = start + (lines[index] || '').length;
    show('source');
    source.focus();
    source.setSelectionRange(caretOnly ? end : start, end);
  }

  // ---------- tabs ----------
  function show(tab) {
    $('editor').hidden = tab !== 'source';
    expanded.hidden = tab !== 'expanded';
    $('tab-source').setAttribute('aria-selected', tab === 'source');
    $('tab-expanded').setAttribute('aria-selected', tab === 'expanded');
  }
  $('tab-source').onclick = () => show('source');
  $('tab-expanded').onclick = () => show('expanded');

  // ---------- messages under the editor ----------
  // The compiler says "line 3: unknown word 'tect'; did you mean 'text'?". Shown as: the line, what is wrong, the
  // suggestion, and a button that applies it. The line is also marked in the editor.
  const sentence = text => { const t = text.trim(); return t ? t[0].toUpperCase() + t.slice(1) + (/[.?!]$/.test(t) ? '' : '.') : ''; };
  function showProblem(error, note) {
    $('problem').hidden = !error;
    errorLine = 0;
    if (!error) return;
    const [, line, rest] = String(error.message).match(/^line (\d+): ([\s\S]*)$/) || [null, error.line || 0, String(error.message)];
    const [, what, word, more] = rest.match(/^([\s\S]*?)[;,.]? did you mean '([^']+)'\?\s*([\s\S]*)$/) || [null, rest, '', ''];
    const wrong = word && (what.match(/'([^']+)'/) || [])[1];
    errorLine = Number(line) || 0;
    $('problem-line').textContent = note ? 'Note' : errorLine ? `Line ${errorLine}` : 'Problem';
    $('problem-text').textContent = sentence(what) + (more ? ' ' + more : '');
    $('problem-hint').textContent = word ? `Did you mean '${word}'?` : '';
    $('problem-fix').hidden = !(wrong && errorLine);
    $('problem-fix').textContent = `Use ${word}`;
    $('problem-fix').onclick = () => {
      const lines = source.value.split('\n');
      lines[errorLine - 1] = lines[errorLine - 1].replace(wrong, word);
      source.value = lines.join('\n');
      build();
    };
  }
  $('problem-line').onclick = () => { if (errorLine) selectLine(errorLine - 1); };   // jump to the line

  // ---------- preview ----------
  // Two stacked frames. A page loads in the one underneath and comes to the front when it says it is ready, so
  // the picture never goes blank, even while a colour is being dragged. Each page gets previewBridge() added.
  let front = $('preview'), back = $('preview-spare');
  let jobs = 0, shown = null, loading = null, queued = null;   // a job is { id, page, from, build }
  let clock = { time: 0, playing: true, slide: 0, stamp: Date.now() };   // where the front page is, as it last said
  const now = () => ({ ...clock, time: clock.time + (clock.playing ? (Date.now() - clock.stamp) / 1000 : 0), stamp: Date.now() });

  // This function runs inside every preview page. It fetches the page's media from the playground, takes over the
  // clock of the page it replaces, reports its own clock, loops the piece and passes on keys, clicks and drops.
  function previewBridge(id, from) {
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
      tell({ ready: true, stamp: Date.now(), ...state() });
      let ended = 0;
      setInterval(() => {
        const here = state(), length = window.duration || window.__PRISM_DURATION__;
        tell({ stamp: Date.now(), ...here });
        // A piece that has played to its end holds its last frame for a moment, then starts again.
        if (slideshow() || here.playing || here.time < length - .05) { ended = 0; return; }
        ended = ended || Date.now();
        if (Date.now() - ended < 1500) return;
        ended = 0;
        window.seek(0);
        if (typeof window.play === 'function') window.play(); else document.getElementById('play').click();
      }, 100);
    }
    addEventListener('message', event => {
      const data = event.data || {};
      if (data.orbKey) key(data.orbKey);
      if (!data.orbMedia) return;
      if (window.__orb) window.__orb.media(Object.fromEntries(Object.entries(data.orbMedia).map(([name, blob]) => [name, URL.createObjectURL(blob)])));
      begin();
    });
    addEventListener('pointerdown', () => tell({ clicked: true }));
    addEventListener('dragover', event => event.preventDefault());
    addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer.files[0]) tell({ drop: event.dataTransfer.files[0] }); });
    tell({ hello: true });
  }
  const framed = job => `${job.page.html}<script>${previewBridge}previewBridge(${job.id}, ${JSON.stringify(job.from)});</script>`;

  // keep: the new page continues where the current one is, instead of starting at 0.
  function showPage(page, keep) {
    const job = { id: ++jobs, page, from: keep && shown ? now() : null };
    if (loading) queued = job; else loadPage(job);   // one page loads at a time; of those waiting, the newest wins
    return job;
  }
  function loadPage(job) {
    loading = job;
    back.srcdoc = framed(job);
    job.timer = setTimeout(() => arrive(job), 2000);   // a page that never reports is shown all the same
  }
  function arrive(job) {
    if (loading !== job) return;
    clearTimeout(job.timer);
    loading = null;
    shown = job;
    [front, back] = [back, front];
    back.id = 'preview-spare'; back.setAttribute('aria-hidden', 'true'); back.tabIndex = -1;
    front.id = 'preview'; front.removeAttribute('aria-hidden'); front.removeAttribute('tabindex');
    if (document.activeElement === back) front.focus();   // keys keep going to the page on show
    back.srcdoc = '';
    document.body.dataset.shown = job.build;   // lets a test wait until a build is on screen
    if (queued) { const next = queued; queued = null; if (next.from) next.from = now(); loadPage(next); }
  }
  // Media files reach a preview as Blobs, which it turns into object URLs. A file is wrapped once.
  const blobs = new WeakMap();
  const mediaFor = page => Object.fromEntries(Object.entries(page.media).map(([name, file]) => {
    if (!blobs.has(file.bytes.buffer)) blobs.set(file.bytes.buffer, new Blob([file.bytes], { type: file.type }));
    return [name, blobs.get(file.bytes.buffer)];
  }));
  addEventListener('message', event => {
    const data = event.data, job = data && [loading, shown].find(each => each && each.id === data.orb);
    if (!job || (event.source !== front.contentWindow && event.source !== back.contentWindow)) return;
    if (data.hello) return event.source.postMessage({ orbMedia: mediaFor(job.page) }, '*');
    if (data.drop) return dropped(data.drop);
    if (data.clicked) return hideHint();
    if (job === loading && data.ready) arrive(job);
    if (job === shown) clock = { time: data.time, playing: data.playing, slide: data.slide, stamp: data.stamp };
  });

  // A slideshow waits for the visitor. Say how to move, until they do, and pass arrow keys on to it, so there
  // is no need to click inside the preview first.
  let hinted = false;
  function hideHint() { hinted = true; hint.hidden = true; }
  addEventListener('keydown', event => {
    const where = document.activeElement.tagName;
    if (!built || !built.present || event.metaKey || event.ctrlKey || event.altKey || ['TEXTAREA', 'INPUT', 'SELECT'].includes(where)) return;
    const moves = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
    if (!moves.includes(event.code) && !(event.code === 'Space' && where !== 'BUTTON')) return;
    event.preventDefault();
    front.contentWindow.postMessage({ orbKey: event.code }, '*');
    hideHint();
  });

  // ---------- build ----------
  // An edit builds a new page that starts from 0 (the result replays). A colour or media change builds with
  // keep, and the new page carries on from the same moment.
  let builds = 0, built = null, timer = 0, stopRecording = null;
  function build(keep) {
    clearTimeout(timer);
    if (stopRecording) return;   // a recording owns the preview; the source is built again when it ends
    const text = source.value, bytes = new TextEncoder().encode(text).length, lines = text.split('\n').filter(line => line.trim()).length;
    let page = '';
    built = null;
    showProblem(null);
    $('warnings').hidden = true;
    $('empty').hidden = !!text.trim();
    expanded.textContent = '';
    if (text.trim()) {
      try { expanded.textContent = Orb.expand(text); } catch (error) { expanded.textContent = error.message; }
      try {
        built = Orb.preview(text);
        showPage(built, keep === true).build = builds + 1;
        $('warnings').hidden = !built.warnings.length;
        $('warnings').textContent = built.warnings.join('\n');
        const weight = built.html.length + Object.values(built.media).reduce((sum, file) => sum + file.bytes.length * 4 / 3, 0);
        page = `, ${built.kind === 'player' ? 'interactive page' : 'video page'} ${(weight / 1024).toFixed(0)} KB`;
      } catch (error) { showProblem(error); }
    }
    $('export').disabled = $('record').disabled = !built;
    hint.hidden = !(built && built.present) || hinted;
    $('size').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}, ${bytes.toLocaleString('en')} bytes, about ${Math.ceil(bytes / 4).toLocaleString('en')} tokens (bytes / 4, estimate)${page}`;
    drawGutter();
    drawPalette();
    lessonProgress();
    document.body.dataset.builds = ++builds;   // lets a test wait for the next build
  }
  source.addEventListener('input', () => {
    drawGutter();
    clearTimeout(timer);
    timer = setTimeout(build, 300);   // build once typing stops
  });

  // ---------- colours: one swatch per colour in the source ----------
  const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
  const widen = hex => hex.length < 7 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;   // #rgb(a) -> #rrggbb(aa)
  let picking = false, picked = null, frame = 0;   // the swatches are left alone while a colour is being dragged
  function drawPalette() {
    if (!picking) {
      const seen = new Map();
      for (const [hex] of source.value.matchAll(HEX)) if (!seen.has(hex.toLowerCase())) seen.set(hex.toLowerCase(), hex);
      swatches.replaceChildren(...[...seen.values()].map(hex => {
        const label = document.createElement('label'), input = document.createElement('input');
        label.className = 'swatch';
        label.dataset.colour = hex;
        input.type = 'color';
        input.value = widen(hex).slice(0, 7).toLowerCase();
        input.setAttribute('aria-label', `Change the colour ${hex}`);
        label.append(input, hex);
        return label;
      }));
    }
    chips.replaceChildren(...mediaNames(source.value).map(name => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = Orb.fs.existsSync('/work/' + name) ? 'chip' : 'chip missing';
      chip.dataset.name = name;
      chip.dataset.kind = kindOf(name);
      chip.title = `Replace ${name} with a file of yours`;
      chip.textContent = name;
      return chip;
    }));
    palette.hidden = !swatches.children.length && !chips.children.length;
  }
  // Dragging in the colour picker fires many times a second: the source is rewritten and built once per frame.
  swatches.addEventListener('input', event => {
    picking = true;
    picked = event.target;
    frame = frame || requestAnimationFrame(recolour);
  });
  swatches.addEventListener('change', () => { picking = false; drawPalette(); });
  function recolour() {
    frame = 0;
    const label = picked.parentElement, old = label.dataset.colour;
    let next = picked.value + widen(old).slice(7);   // a colour keeps its transparency
    // Two colours of the file stay two: a pick that lands exactly on another one moves by a shade no eye can see.
    if ([...swatches.children].some(other => other !== label && other.dataset.colour.toLowerCase() === next.toLowerCase())) next = next.slice(0, 6) + (parseInt(next[6], 16) ^ 1).toString(16) + next.slice(7);
    if (next.toLowerCase() === old.toLowerCase()) return;
    const top = source.scrollTop;
    source.value = source.value.replace(new RegExp(`(?<![\\w&])${old}(?![\\w-])`, 'gi'), next);
    source.scrollTop = top;
    label.dataset.colour = next;
    label.lastChild.textContent = next;
    build(true);
  }

  // ---------- media: the files the source names ----------
  const KINDS = { image: /\.(?:png|jpe?g|svg|webp|gif|avif)$/i, video: /\.(?:mp4|webm|mov|m4v)$/i, audio: /\.(?:mp3|wav|ogg|m4a|aac|flac)$/i, font: /\.(?:woff2?|ttf|otf)$/i };
  const ACCEPT = { image: '.png,.jpg,.jpeg,.svg,.webp', video: '.mp4,.webm', audio: '.mp3,.wav,.ogg,.m4a', font: '.woff2,.woff,.ttf,.otf' };
  const kindOf = name => Object.keys(KINDS).find(kind => KINDS[kind].test(name));
  // In source order: the file of an image, video, audio or font line, of image=, logo=, bg= and the like, of [img name].
  function mediaNames(text) {
    const names = [...text.matchAll(/^\s*(?:image|video|audio|font)\s+"([^"\n]+)"|\b(?:image|logo|corner|font|audio|bg)="?([^"\s]+)|\[img\s+([^\]\s]+)/gm)].map(match => match[1] || match[2] || match[3]);
    return [...new Set(names.filter(name => kindOf(name) && !/^(?:https?:|data:|\/\/)/.test(name)))];
  }
  // A video's length, read from the file itself: a looping video needs it, and there is no ffprobe here.
  const videoLength = file => new Promise(done => {
    const video = document.createElement('video'), url = URL.createObjectURL(file);
    const end = seconds => { URL.revokeObjectURL(url); done(seconds); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => end(Number.isFinite(video.duration) ? video.duration : 0);
    video.onerror = () => end(0);
    video.src = url;
  });
  // Put a file in the in-memory folder the source builds from, under `name`.
  async function store(name, file) {
    Orb.fs.writeFileSync('/work/' + name, new Uint8Array(await file.arrayBuffer()));
    const seconds = kindOf(name) === 'video' ? await videoLength(file) : 0;
    if (seconds) Orb.lengths.set('/work/' + name, seconds); else Orb.lengths.delete('/work/' + name);
  }
  async function replace(name, file) {
    if (kindOf(file.name) !== kindOf(name)) return showProblem({ message: `${name} is ${kindOf(name) === 'image' || kindOf(name) === 'audio' ? 'an' : 'a'} ${kindOf(name)} file, so it needs ${ACCEPT[kindOf(name)].replace(/,/g, ', ')}.` }, true);
    await store(name, file);
    build(true);
  }
  // A new item must not split a block, so it goes after the block the cursor is in. Items live under the motion
  // line (2 spaces); in a file with scenes they live inside a scene (4 spaces).
  function insertItem(item) {
    const player = Orb.isPlayer(source.value), indent = player ? 4 : 2, lines = source.value.split('\n');
    const first = lines.findIndex(line => player ? /^ {2}scene(\s|$)/.test(line) : /^motion(\s|$)/.test(line)) + 1;
    let at = Math.max(first, source.value.slice(0, source.selectionStart).split('\n').length);
    while (at < lines.length && (!lines[at].trim() || lines[at].match(/^ */)[0].length > indent)) at++;
    while (at > first && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ' '.repeat(indent) + item);
    source.value = lines.join('\n');
    selectLine(at, true);
    build();
  }
  async function add(file) {
    const kind = kindOf(file.name), player = Orb.isPlayer(source.value), name = file.name.replace(/[^\w.-]+/g, '-');
    if (kind !== 'image' && kind !== 'video') return showProblem({ message: 'Add image or video takes a png, jpg, svg, webp, mp4 or webm file.' }, true);
    if (kind === 'video' && player) return showProblem({ message: 'Scenes take images only. A video goes in a video file, one without scene lines: try the sample "Swap the image and the colours".' }, true);
    await store(name, file);
    insertItem(kind === 'video' ? `video "${name}" at=0 box=200,200,800,450 fit=cover sound=off` : player ? `image image=${name}` : `image "${name}" at=0 box=200,200,600,400`);
  }
  // A file dropped on the page replaces the first picture (or video) of the source, or is added when there is none.
  function dropped(file) {
    const target = mediaNames(source.value).find(name => ['image', 'video'].includes(kindOf(name)) && kindOf(name) === kindOf(file.name));
    return target ? replace(target, file) : add(file);
  }
  const picker = $('media-file');
  let chosen = null;   // what to do with the file the picker returns
  function pick(accept, then) { picker.accept = accept; chosen = then; picker.click(); }
  picker.onchange = () => {
    const file = picker.files[0], then = chosen || add;
    picker.value = '';
    chosen = null;
    if (file) then(file);
  };
  $('add-media').onclick = () => pick(`${ACCEPT.image},${ACCEPT.video}`, add);
  chips.addEventListener('click', event => {
    const chip = event.target.closest('.chip');
    if (chip) pick(ACCEPT[chip.dataset.kind], file => replace(chip.dataset.name, file));
  });
  addEventListener('dragover', event => event.preventDefault());
  addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer.files[0]) dropped(event.dataTransfer.files[0]); });

  // ---------- export: the result as one file, media inside ----------
  // Downloads are named after the title on the motion line.
  function download(blob, extension) {
    const title = (source.value.match(/^motion\s+"([^"]*)"/m) || [])[1] || '';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'orb'}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  $('export').onclick = () => {
    try { download(new Blob([Orb.build(source.value).html], { type: 'text/html' }), 'html'); } catch (error) { showProblem(error); }
  };

  // ---------- record video: this tab, captured in real time and cropped to the preview ----------
  // This function runs inside the preview while recording. It hides the control bar, waits at 0 and plays once
  // when told to. A video page keeps its own clock (and its sound); a page with scenes is stepped from here.
  function recordDriver() {
    if (typeof window.seek !== 'function') return setTimeout(recordDriver, 50);
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
  const recordStatus = $('record-status');
  $('record').onclick = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
      recordStatus.innerHTML = 'Recording needs a Chromium browser; use <code>orb render file.orb out.mp4 1080</code> for MP4';
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, preferCurrentTab: true, audio: true }); }
    catch { recordStatus.textContent = 'Recording was not started.'; return; }
    const piece = built, [track] = stream.getVideoTracks(), chunks = [];
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9'].find(each => MediaRecorder.isTypeSupported(each));
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {});
    let save = false, ticker = null, whole = '';

    // One way out, for the end of the piece, Cancel and "stop sharing".
    stopRecording = keep => {
      save = keep;
      clearInterval(ticker);
      removeEventListener('message', ready);
      if (recorder.state === 'inactive') finish(); else recorder.stop();
    };
    function finish() {
      stream.getTracks().forEach(each => each.stop());
      if (save && chunks.length) download(new Blob(chunks, { type: recorder.mimeType }), /mp4/.test(recorder.mimeType) ? 'mp4' : 'webm');
      recordStatus.textContent = save ? 'Recording saved' : 'Recording cancelled';
      $('cancel-record').hidden = true;
      front.style.cssText = '';
      stopRecording = null;
      build();   // back to the normal preview, with whatever the source is now
    }
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = finish;
    track.onended = () => stopRecording && stopRecording(false);
    $('cancel-record').onclick = () => stopRecording(false);
    $('cancel-record').hidden = false;
    $('export').disabled = $('record').disabled = true;
    hint.hidden = true;

    // Give the preview the shape of the piece, so the crop holds the stage and nothing else.
    const room = $('frames').getBoundingClientRect(), scale = Math.min(room.width / piece.width, room.height / piece.height);
    const width = Math.floor(piece.width * scale), height = Math.floor(piece.height * scale);
    front.style.cssText = `inset:auto;left:${(room.width - width) / 2}px;top:${(room.height - height) / 2}px;width:${width}px;height:${height}px`;
    try { await track.cropTo(await CropTarget.fromElement(front)); }
    catch { whole = ' (the whole tab: this browser cannot crop to the preview)'; }
    if (!stopRecording) return;   // cancelled while the crop was being set
    recordStatus.textContent = 'Recording starts' + whole;

    // The preview loads the same page plus the driver above, says when it waits at 0, and plays on "go".
    function ready(event) {
      if (event.source !== front.contentWindow || event.data !== 'orb-record-ready') return;
      removeEventListener('message', ready);
      recorder.start();
      const started = performance.now() + 200;   // a short lead in, so the first frame is on the recording
      setTimeout(() => front.contentWindow.postMessage('orb-record-go', '*'), 200);
      ticker = setInterval(() => {
        const elapsed = Math.max(0, (performance.now() - started) / 1000);
        recordStatus.textContent = `Recording ${Math.min(elapsed, piece.duration).toFixed(1)} / ${piece.duration.toFixed(1)} s${whole}`;
        if (elapsed >= piece.duration + .3) stopRecording(true);
      }, 100);
    }
    addEventListener('message', ready);
    if (loading) clearTimeout(loading.timer);
    loading = queued = null;
    shown = { id: ++jobs, page: piece, from: null };
    front.srcdoc = `${framed(shown)}<script>${recordDriver}recordDriver();</script>`;
  };

  // ---------- samples ----------
  for (const [i, sample] of Orb.samples.entries()) samples.add(new Option(sample.title, i));
  function load(text) {
    hinted = false;
    source.value = text;
    source.scrollTop = 0;
    show('source');
    build();
  }
  samples.onchange = () => {
    if (!Orb.samples[samples.value]) return;
    closeLesson();
    load(Orb.samples[samples.value].source);
    samples.blur();   // so arrow keys go to a slideshow, not to this menu
  };
  $('empty-start').onclick = () => load(ORB_LESSONS[0].source);

  // ---------- Learn Orb: one small file and one change per step ----------
  const lessons = ORB_LESSONS, work = [], done = [];
  let step = -1, resume = 0;   // step -1: not in the tutorial; lessons.length: the closing words
  const keepWork = () => { if (lessons[step]) work[step] = source.value; };
  function openLesson(to) {
    keepWork();
    step = Math.max(0, Math.min(lessons.length, to));
    const lesson = lessons[step];
    samples.value = '';
    $('lesson').hidden = false;
    $('lesson-title').textContent = lesson ? lesson.title : 'That was the last step';
    $('lesson-say').innerHTML = lesson ? lesson.say : 'You now know Orb. Open the samples or start from an empty file.';
    $('lesson-count').textContent = lesson ? `Step ${step + 1} of ${lessons.length}` : '';
    $('lesson-back').disabled = step === 0;
    for (const id of ['lesson-show', 'lesson-next']) $(id).hidden = !lesson;
    for (const id of ['lesson-samples', 'lesson-empty']) $(id).hidden = !!lesson;
    if (lesson) load(work[step] ?? lesson.source); else lessonProgress();
  }
  function closeLesson() {
    keepWork();
    if (step >= 0) resume = step;
    step = -1;
    $('lesson').hidden = true;
    palette.classList.remove('point');
  }
  // After every build: a step is done once its change is in the source and the source compiles.
  function lessonProgress() {
    const lesson = lessons[step];
    if (lesson && built && lesson.done(source.value)) done[step] = true;
    $('lesson-done').hidden = !(lesson && done[step]);
    palette.classList.toggle('point', !!lesson && lesson.point === 'swatch' && !done[step]);
  }
  $('learn').onclick = () => openLesson(step >= 0 ? step : resume < lessons.length ? resume : 0);
  $('lesson-back').onclick = () => openLesson(step - 1);
  $('lesson-next').onclick = () => openLesson(step + 1);
  $('lesson-show').onclick = () => {
    const lesson = lessons[step], changed = lesson.show(source.value);
    source.value = lesson.done(changed) ? changed : lesson.show(lesson.source);   // from the step's own file when the visitor's has drifted
    build();
  };
  $('lesson-samples').onclick = () => { samples.focus(); try { samples.showPicker(); } catch { /* the menu has the focus; the visitor opens it */ } };
  $('lesson-empty').onclick = () => { closeLesson(); load(''); source.focus(); };

  // ---------- start: a shared link opens its file, anything else opens the tutorial ----------
  function start() {
    const linked = fromHash();
    if (linked === null) return openLesson(0);
    closeLesson();
    samples.value = '';
    load(linked);
  }
  addEventListener('hashchange', start);
  start();
})();
