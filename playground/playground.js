// Orb playground: source on the left, the playing result on the right, all in this page.
//   orb-compiler.js  the compiler the command line uses, bundled for the browser (scripts/build-playground.js)
//   edit.js          reading and rewriting one Orb line, the panel's table of controls, the Add menu
//   bridge.js        the code that runs inside the preview
//   lessons.js       the steps of Learn Orb
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const source = $('source'), gutter = $('gutter'), measure = $('measure'), mark = $('mark'), current = $('current'), expanded = $('expanded');
  const samples = $('samples'), palette = $('palette'), swatches = $('swatches'), chips = $('chips'), hint = $('hint'), panel = $('panel'), fields = $('panel-fields');

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
  // The source is a plain-text editable block, not a textarea: only a block can wrap long lines with a hanging
  // indent, so nothing ever scrolls sideways. It is given the few textarea members the rest of this file uses.
  // Its content is one run of text. A browser may still split lines into blocks (a paste, some keyboards): read()
  // understands those, and tidy() puts the text back in one piece.
  const read = node => [...node.childNodes].map((child, i) => child.nodeType === 3 ? child.data
    : child.nodeName === 'BR' ? (node.nodeName === 'DIV' && node !== source && node.childNodes.length === 1 ? '' : '\n')   // a lone <br> only holds an empty line open
    : (i ? '\n' : '') + read(child)).join('');
  function locate(offset) {   // a text offset -> [node, offset inside it]
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walker.nextNode(); node; last = node, node = walker.nextNode()) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return last ? [last, last.length] : [source, 0];
  }
  function caret() {   // the caret as a text offset; where it last was when the editor does not hold it
    const selection = getSelection();
    if (!selection.rangeCount || !source.contains(selection.focusNode)) return caretAt;
    const range = document.createRange();
    range.selectNodeContents(source);
    range.setEnd(selection.focusNode, selection.focusOffset);
    return read(range.cloneContents()).length;
  }
  let caretAt = 0, indentNext = null;
  Object.defineProperties(source, {
    value: { get: () => read(source), set: text => { source.textContent = text; } },
    selectionStart: { get: caret },
  });
  source.setSelectionRange = (start, end = start) => {
    const range = document.createRange(), selection = getSelection();
    range.setStart(...locate(start));
    range.setEnd(...locate(end));
    selection.removeAllRanges();
    selection.addRange(range);
    caretAt = start;
  };
  function tidy() {
    if (!source.firstElementChild) return;
    const at = caret(), held = source.contains(getSelection().focusNode);
    source.textContent = read(source);
    if (held) source.setSelectionRange(at);
  }
  const lineOf = offset => source.value.slice(0, offset).split('\n').length - 1;
  const insert = text => document.execCommand('insertText', false, text);   // keeps the browser's undo history
  source.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); insert('  '); }   // one level is two spaces
    if (event.key === 'Enter') { const text = source.value, at = caret(); indentNext = text.slice(text.lastIndexOf('\n', at - 1) + 1, at).match(/^ */)[0]; }
  });
  source.addEventListener('input', event => {
    tidy();
    const indent = indentNext;
    indentNext = null;
    if (indent && /insertLineBreak|insertParagraph/.test(event.inputType)) insert(indent);   // a new line starts under the start of the line above
  });

  // Line numbers sit next to the first row of their line. Each line is laid out once more in a hidden copy with
  // the same width and wrapping, which says how tall it is.
  let errorLine = 0, panelLine = 0, tops = [0], heights = [];
  function placeBand(band, index) {
    band.hidden = index < 0 || index >= heights.length || !$('editor').offsetHeight;
    if (!band.hidden) band.style.cssText = `top:${12 + tops[index] - source.scrollTop}px;height:${heights[index]}px`;   // 12 px of padding above the first line
  }
  const placeBands = () => { placeBand(mark, errorLine - 1); placeBand(current, panelLine); };
  function drawGutter() {
    const lines = source.value.split('\n');
    measure.style.width = source.clientWidth + 'px';
    measure.replaceChildren(...lines.map(line => Object.assign(document.createElement('div'), { textContent: line })));
    heights = [...measure.children].map(row => row.offsetHeight);
    tops = [0];
    for (const height of heights) tops.push(tops[tops.length - 1] + height);
    gutter.replaceChildren(...lines.map((line, i) => {
      const number = document.createElement(i + 1 === errorLine ? 'b' : 'span');
      number.textContent = i + 1;
      number.style.cssText = `display:block;height:${heights[i]}px`;
      return number;
    }));
    gutter.scrollTop = source.scrollTop;
    placeBands();
  }
  source.addEventListener('scroll', () => { source.scrollLeft = 0; gutter.scrollTop = source.scrollTop; placeBands(); });
  new ResizeObserver(drawGutter).observe(source);
  function selectLine(index, caretOnly) {
    const lines = source.value.split('\n'), start = lines.slice(0, index).join('\n').length + (index ? 1 : 0), end = start + (lines[index] || '').length;
    show('source');
    source.focus();
    source.setSelectionRange(caretOnly ? end : start, end);
  }
  function reveal(index) {   // scroll the editor so that a line can be seen
    if (tops[index] < source.scrollTop || tops[index] + heights[index] > source.scrollTop + source.clientHeight - 24) source.scrollTop = Math.max(0, tops[index] - 40);
  }

  // ---------- tabs ----------
  function show(tab) {
    $('editor').hidden = tab !== 'source';
    expanded.hidden = tab !== 'expanded';
    $('tab-source').setAttribute('aria-selected', tab === 'source');
    $('tab-expanded').setAttribute('aria-selected', tab === 'expanded');
    if (tab === 'source') drawGutter();
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
    placeBands();
  }
  $('problem-line').onclick = () => { if (errorLine) selectLine(errorLine - 1); };   // jump to the line

  // ---------- preview ----------
  // Two stacked frames. A page loads in the one underneath and comes to the front when it says it is ready, so
  // the picture never goes blank, even while a colour is being dragged. Each page gets orbPreviewBridge() added.
  let front = $('preview'), back = $('preview-spare');
  let jobs = 0, shown = null, loading = null, queued = null;   // a job is { id, page, from, edit, build }
  let clock = { time: 0, playing: true, slide: 0, stamp: Date.now() };   // where the front page is, as it last said
  let selected = null;   // the item selected in the preview, if any
  const now = () => ({ ...clock, time: clock.time + (clock.playing ? (Date.now() - clock.stamp) / 1000 : 0), stamp: Date.now() });
  const framed = job => `${job.page.html}<script>${orbPreviewBridge}orbPreviewBridge(${job.id}, ${JSON.stringify(job.from)}, ${JSON.stringify(job.edit)});</script>`;

  // keep: the new page continues where the current one is, instead of starting at 0. playing: whether it then
  // plays, when that is not what the current page does (it is paused while an item is dragged).
  function showPage(page, keep, playing) {
    const job = { id: ++jobs, page, from: keep && shown ? now() : null, edit: { ids: page.movable, select: selected } };
    if (job.from && playing !== undefined) job.from.playing = playing;
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
    if (queued) { const next = queued; queued = null; if (next.from) next.from = { ...now(), playing: next.from.playing }; loadPage(next); }
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
    if ('picked' in data) return pickedInPreview(data.picked);
    if (data.box) return boxFromPreview(data);
    if (job === loading && data.ready) arrive(job);
    if (job === shown) clock = { time: data.time, playing: data.playing, slide: data.slide, stamp: data.stamp };
  });

  // A slideshow waits for the visitor. Say how to move, until they do, and pass arrow keys on to it, so there
  // is no need to click inside the preview first.
  let hinted = false;
  function hideHint() { hinted = true; hint.hidden = true; }
  addEventListener('keydown', event => {
    const where = document.activeElement.tagName;
    if (!built || !built.present || event.metaKey || event.ctrlKey || event.altKey || ['TEXTAREA', 'INPUT', 'SELECT'].includes(where) || source.contains(document.activeElement)) return;
    const moves = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'];
    if (!moves.includes(event.code) && !(event.code === 'Space' && where !== 'BUTTON')) return;
    event.preventDefault();
    front.contentWindow.postMessage({ orbKey: event.code }, '*');
    hideHint();
  });

  // ---------- build ----------
  // An edit in the source builds a new page that starts from 0 (the result replays). A change made with a swatch,
  // the panel, a media chip or a handle builds with keep, and the new page carries on from the same moment.
  let builds = 0, built = null, timer = 0, soon = 0, stopRecording = null;
  // The items of a video page that can be moved in the preview: a text, rect, image or video line that makes one
  // item, has no box or a box of plain numbers, and is not a full-frame backdrop.
  function movable(page, text) {
    if (!page.map) return [];
    const lines = text.split('\n'), uses = {};
    for (const item of page.map.items) uses[item.line] = (uses[item.line] || 0) + 1;
    return page.map.items.filter(item => {
      const line = lines[item.line - 1] || '', box = OrbEdit.get(line, 'box'), [x, y, w, h] = item.box;
      return uses[item.line] === 1 && ['text', 'rect', 'image', 'video'].includes(OrbEdit.parse(line).word) && (box === undefined || /^-?[\d.]+(?:,-?[\d.]+){3}$/.test(box))
        && !(x <= 0 && y <= 0 && x + w >= page.width && y + h >= page.height);
    }).map(item => item.id);
  }
  const itemAt = (page, index) => page && page.map ? page.movable.find(id => page.map.ids[id] === index + 1) || null : null;
  function build(keep, playing) {
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
        built.movable = movable(built, text);
        if (selected) selected = itemAt(built, panelLine);   // the same line may be another item now
        showPage(built, keep === true, playing).build = builds + 1;
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
    drawPanel();
    drawPalette();
    lessonProgress();
    document.body.dataset.builds = ++builds;   // lets a test wait for the next build
  }
  const buildSoon = () => { soon = soon || requestAnimationFrame(() => { soon = 0; build(true); }); };   // at most once a frame
  source.addEventListener('input', () => {
    drawGutter();
    drawPanel();
    clearTimeout(timer);
    timer = setTimeout(build, 300);   // build once typing stops
  });
  // Rewrite one line of the source. quiet: do not build yet (a drag in the preview builds when it ends).
  function editLine(index, change, quiet) {
    const lines = source.value.split('\n'), next = change(lines[index] || ''), top = source.scrollTop;
    if (next === lines[index]) return;
    lines[index] = next;
    source.value = lines.join('\n');
    source.scrollTop = top;
    drawGutter();
    drawPanel();
    if (!quiet) buildSoon();
  }

  // ---------- the line in hand: where the cursor is, or the item selected in the preview ----------
  function followCaret() {
    const line = lineOf(caretAt = caret());
    if (line === panelLine && !selected) return;
    panelLine = line;
    selected = itemAt(built, line);
    if (front.contentWindow) front.contentWindow.postMessage({ orbSelect: selected }, '*');
    drawPanel();
    placeBands();
  }
  // The caret moved in the editor, or the editor was clicked: the panel goes back to the caret's line.
  document.addEventListener('selectionchange', () => { if (document.activeElement === source && caret() !== caretAt) followCaret(); });
  source.addEventListener('focus', () => setTimeout(followCaret));   // once the click has placed the caret
  function pickedInPreview(id) {
    selected = id;
    panelLine = id ? shown.page.map.ids[id] - 1 : lineOf(caretAt);
    drawPanel();
    placeBands();
    reveal(panelLine);
  }
  // A handle moved: the item's new box goes into its line. The page is rebuilt when the drag ends.
  function boxFromPreview(data) {
    editLine(shown.page.map.ids[data.item] - 1, line => OrbEdit.set(line, 'box', data.box.join(',')), true);
    if (data.done) build(true, data.resume);
  }

  // ---------- properties panel: a control for each option the word on that line takes ----------
  const widen = hex => hex.length < 7 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;   // #rgb(a) -> #rrggbb(aa)
  const accepts = {};   // "does the compiler take this option on this word?", asked once
  const sample = spec => spec.probe || { colour: '#ff0000', box: '10,10,100,100', colours: '#ff0000,#00ff00' }[spec.kind]
    || (spec.kind === 'menu' ? spec.choices.find(Boolean) : spec.kind === 'words' ? spec.unset || 'x' : String(spec.unset === '' ? Math.max(spec.min, 1) : spec.unset));
  function accepted(lines, parsed, spec, scenes) {
    const key = `${scenes}/${parsed.word}/${spec.name}`;
    if (parsed.tokens.some(token => token.name === spec.name)) return true;
    if (!(key in accepts) && built) {   // with an error in the file nothing can be asked: show the control for now
      const probe = lines.slice();
      probe[panelLine] = OrbEdit.set(lines[panelLine], spec.name, sample(spec));
      try { Orb.check(probe.join('\n')); accepts[key] = true; } catch { accepts[key] = false; }
    }
    return accepts[key] !== false;
  }
  function field(spec) {
    const el = document.createElement('div'), label = el.appendChild(document.createElement('span')), name = spec.kind === 'quoted' ? 'text' : spec.name;
    const control = (tag, more) => { const made = Object.assign(el.appendChild(document.createElement(tag)), more); made.setAttribute('aria-label', name); return made; };
    el.className = spec.kind === 'quoted' ? 'field wide' : 'field';
    el.dataset.name = name;
    el.spec = spec;
    label.textContent = name;
    if (spec.kind === 'menu') control('select').append(...spec.choices.map(choice => new Option(choice || 'none', choice)));
    else if (spec.kind === 'box') for (const part of ['x', 'y', 'width', 'height']) control('input', { type: 'number', title: part });
    else if (spec.kind === 'slider') { control('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step }); el.appendChild(document.createElement('output')); }
    else if (spec.kind === 'number') control('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step, placeholder: String(spec.unset) || 'auto' });
    else if (spec.kind !== 'colours') control('input', { type: spec.kind === 'colour' ? 'color' : 'text' });
    if (spec.kind !== 'quoted') Object.assign(el.appendChild(document.createElement('button')), { type: 'button', className: 'clear', textContent: 'x', title: `Remove ${name}` });
    return el;
  }
  // Show a line's value in a control. A control the visitor is using is left alone.
  function fill(el, line) {
    const spec = el.spec, parsed = OrbEdit.parse(line), value = spec.kind === 'quoted' ? OrbEdit.text(line) : OrbEdit.get(line, spec.name);
    const item = built && built.map && built.map.items.find(each => each.line === panelLine + 1);
    let shows = value === undefined ? String(spec.unset) : value;
    el.classList.toggle('unset', value === undefined);
    if (el.contains(document.activeElement)) return;
    if (spec.kind === 'colours') {   // one picker for each bar or point (a bare number), or each slice of a donut (name=number)
      const options = new Set(OrbEdit.controls(parsed.word, true).map(each => each.name)), number = text => /^-?[\d.]+$/.test(text);
      const count = parsed.tokens.slice(1).filter(token => token.name ? parsed.word === 'donut' && !options.has(token.name) && number(token.value) : number(token.text)).length;
      if (el.querySelectorAll('input').length !== count) {
        for (const old of el.querySelectorAll('input')) old.remove();
        for (let i = 0; i < count; i++) el.insertBefore(Object.assign(document.createElement('input'), { type: 'color', title: `colour ${i + 1}` }), el.lastChild);
      }
    }
    const inputs = [...el.querySelectorAll('input, select')];
    if (spec.kind === 'box') { if (value === undefined && item) shows = item.box.map(Math.round).join(','); inputs.forEach((input, i) => { input.value = shows.split(',')[i] || ''; }); }
    else if (spec.kind === 'colours') inputs.forEach((input, i) => { input.value = widen(shows.split(',')[i] || '#6ea8ff').slice(0, 7); });
    else if (spec.kind === 'colour') inputs[0].value = /^#[0-9a-f]{3,8}$/i.test(shows) ? widen(shows).slice(0, 7).toLowerCase() : spec.unset;
    else if (spec.kind === 'menu') { if (![...inputs[0].options].some(each => each.value === shows)) inputs[0].add(new Option(shows, shows)); inputs[0].value = shows; }
    else if (spec.kind === 'number') inputs[0].value = value === undefined || isNaN(value) ? '' : value;
    else inputs[0].value = shows;
    if (spec.kind === 'slider') el.querySelector('output').textContent = shows;
  }
  function drawPanel() {
    const lines = source.value.split('\n'), line = lines[panelLine], parsed = line === undefined ? null : OrbEdit.parse(line);
    panel.hidden = !parsed || !parsed.word;
    if (panel.hidden) return;
    const scenes = Orb.isPlayer(source.value), key = `${panelLine}|${scenes}|${parsed.word}|${OrbEdit.text(line) === undefined}`;
    if (key !== panel.dataset.key || !panel.contains(document.activeElement)) {   // the controls stay put while one of them is in use
      const specs = OrbEdit.controls(parsed.word, scenes, Orb.fonts).filter(spec => accepted(lines, parsed, spec, scenes));
      panel.dataset.key = key;
      $('panel-word').textContent = parsed.word;
      $('panel-where').textContent = `line ${panelLine + 1}${specs.length || OrbEdit.text(line) !== undefined ? '' : ': no controls for this word, edit it in the source'}`;
      fields.replaceChildren(...(OrbEdit.text(line) === undefined ? [] : [field({ name: '', kind: 'quoted' })]), ...specs.map(field));
    }
    for (const el of fields.children) fill(el, line);
  }
  fields.addEventListener('input', event => {
    const el = event.target.closest('.field'), spec = el.spec, inputs = [...el.querySelectorAll('input, select')];
    const value = spec.kind === 'box' ? inputs.map(input => Math.round(Number(input.value) || 0)).join(',') : spec.kind === 'colours' ? inputs.map(input => input.value).join(',') : inputs[0].value;
    if (spec.kind === 'slider') el.querySelector('output').textContent = value;
    editLine(panelLine, line => spec.kind === 'quoted' ? OrbEdit.setText(line, value) : value === '' ? OrbEdit.remove(line, spec.name) : OrbEdit.set(line, spec.name, value));
  });
  fields.addEventListener('click', event => {
    if (event.target.className === 'clear') editLine(panelLine, line => OrbEdit.remove(line, event.target.closest('.field').spec.name));
  });

  // ---------- colours: one swatch per colour in the source ----------
  const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
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
  // New lines must not split a block, so they go after the block the cursor is in. indent 2: under the motion
  // line (an item of a video file, or a whole scene); indent 4: inside a scene. A line of `items` that starts
  // with spaces goes under the one before it.
  function insertLines(items, indent) {
    const lines = source.value.split('\n');
    const first = lines.findIndex(line => indent === 4 ? /^ {2}scene(\s|$)/.test(line) : /^motion(\s|$)/.test(line)) + 1;
    let at = Math.max(first, lineOf(caretAt) + 1);
    while (at < lines.length && (!lines[at].trim() || lines[at].match(/^ */)[0].length > indent)) at++;
    while (at > first && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...items.map(item => ' '.repeat(indent) + item));
    source.value = lines.join('\n');
    selectLine(at, true);
    panelLine = at;
    build();
  }
  async function add(file) {
    const kind = kindOf(file.name), name = file.name.replace(/[^\w.-]+/g, '-');
    if (kind !== 'image' && kind !== 'video') return showProblem({ message: 'Image or video takes a png, jpg, svg, webp, mp4 or webm file.' }, true);
    if (!source.value.trim()) source.value = OrbEdit.STARTER[kind === 'video' ? 'video' : 'scenes'].join('\n');
    const scenes = Orb.isPlayer(source.value);
    if (kind === 'video' && scenes) return showProblem({ message: 'Scenes take images only. A video goes in a video file, one without scene lines: try the sample "Swap the image and the colours".' }, true);
    await store(name, file);
    insertLines([kind === 'video' ? `video "${name}" at=0 box=200,200,800,450 fit=cover sound=off` : scenes ? `image image=${name}` : `image "${name}" at=0 box=200,200,600,400`], scenes ? 4 : 2);
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
  chips.addEventListener('click', event => {
    const chip = event.target.closest('.chip');
    if (chip) pick(ACCEPT[chip.dataset.kind], file => replace(chip.dataset.name, file));
  });
  addEventListener('dragover', event => event.preventDefault());
  addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer.files[0]) dropped(event.dataTransfer.files[0]); });

  // ---------- Add: ready lines, so nobody starts from a blank one ----------
  const adder = $('add');
  for (const [i, entry] of OrbEdit.ADD.entries()) adder.add(new Option(entry.title, i));
  adder.onchange = () => {
    const entry = OrbEdit.ADD[adder.value];
    adder.value = '';
    if (!entry) return;
    if (entry.file) return pick(`${ACCEPT.image},${ACCEPT.video}`, add);
    if (!source.value.trim()) { source.value = OrbEdit.STARTER.scenes.slice(0, entry.block ? 1 : 2).join('\n'); caretAt = source.value.length; }
    const scenes = Orb.isPlayer(source.value) || /^motion\b[^\n]*$/.test(source.value.trim()) && !!entry.block, make = scenes ? entry.scenes : entry.video;
    if (!make) return showProblem({ message: `${entry.title} needs a file with scenes. Pick a sample that has scene lines, or empty the editor and add it again.` }, true);
    if (!scenes && entry.needs && !source.value.includes(entry.needs)) { source.value = `${entry.needs}\n${source.value}`; caretAt += entry.needs.length + 1; }
    insertLines(make(built ? built.width : 1920, built ? built.height : 1080), entry.block || !scenes ? 2 : 4);
  };

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

    // The preview loads the same page plus orbRecordDriver(), says when it waits at 0, and plays on "go".
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
    shown = { id: ++jobs, page: piece, from: null, edit: { ids: [], select: null } };   // nothing is selected in a recording
    front.srcdoc = `${framed(shown)}<script>${orbRecordDriver}orbRecordDriver();</script>`;
  };

  // ---------- samples ----------
  for (const [i, sample] of Orb.samples.entries()) samples.add(new Option(sample.title, i));
  function load(text) {
    hinted = false;
    selected = null;
    caretAt = panelLine = 0;
    source.value = text;
    source.scrollTop = source.scrollLeft = 0;
    show('source');
    build();
  }
  const openSamples = () => { samples.focus(); try { samples.showPicker(); } catch { /* the menu has the focus; the visitor opens it */ } };
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
    for (const id of ['lesson-show', 'lesson-next', 'lesson-menu', 'lesson-skip']) $(id).hidden = !lesson;
    for (const id of ['lesson-samples', 'lesson-empty']) $(id).hidden = !!lesson;
    if (lesson) load(work[step] ?? lesson.source); else lessonProgress();
  }
  function closeLesson() {
    keepWork();
    if (step >= 0) resume = step;
    step = -1;
    $('lesson').hidden = true;
    palette.classList.remove('point');
    drawGutter();   // the editor has more room now
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
  $('lesson-samples').onclick = $('lesson-menu').onclick = openSamples;
  $('lesson-empty').onclick = () => { closeLesson(); load(''); source.focus(); };
  $('lesson-skip').onclick = () => { closeLesson(); source.focus(); };   // the file of the step stays in the editor

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
