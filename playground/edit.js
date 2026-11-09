// What the playground knows about Orb lines: how to read and rewrite one, which controls each word gets in the
// properties panel, and the ready lines of the Add menu. No page code here, so it also runs in the tests.
//
// To offer a new option in the panel, add one entry to the list of its word (or to STYLE / TIMING for an option
// every scene element takes). The panel only shows an option the compiler accepts on that line, so an entry for
// an option that is not there yet does no harm.
var OrbEdit = (function () {
  // ---------- one line ----------
  // A line is an indent, a word, then values and name=value options. Quotes, {braces} and [lists] can hold spaces.
  // A token that starts with # after a space starts a comment.
  function parse(line) {
    const indent = line.match(/^ */)[0].length, tokens = [];
    let i = indent;
    while (i < line.length) {
      if (line[i] === ' ') { i++; continue; }
      if (line[i] === '#') break;
      const start = i;
      let quote = '', depth = 0;
      for (; i < line.length; i++) {
        const c = line[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
        else if (c === '"' || (c === "'" && /[\s=,[(]/.test(line[i - 1] || ' '))) quote = c;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        else if (c === ' ' && depth <= 0) break;
      }
      const text = line.slice(start, i), option = text.match(/^([A-Za-z][\w-]*)=([\s\S]*)$/);
      tokens.push({ start, end: i, text, name: option ? option[1] : null, value: option ? option[2].replace(/^"([\s\S]*)"$/, '$1') : null });
    }
    return { indent, word: tokens.length ? tokens[0].text : '', tokens, end: tokens.length ? tokens[tokens.length - 1].end : indent };
  }
  const option = (line, name) => parse(line).tokens.find(token => token.name === name);
  const get = (line, name) => { const token = option(line, name); return token ? token.value : undefined; };
  const written = value => /[\s"]/.test(value) || value === '' ? `"${String(value).replace(/"/g, "'")}"` : String(value);
  // Set name=value on a line: in place when the option is there, after the last value when it is not.
  function set(line, name, value) {
    const token = option(line, name), end = parse(line).end, text = `${name}=${written(String(value))}`;
    return token ? line.slice(0, token.start) + text + line.slice(token.end) : `${line.slice(0, end)} ${text}${line.slice(end)}`;
  }
  function remove(line, name) {
    const token = option(line, name);
    return token ? line.slice(0, token.start).replace(/ $/, '') + line.slice(token.end) : line;
  }
  // The first quoted value of a line: the text of a title, a text item, a heading.
  const quoted = line => parse(line).tokens.find(token => token.text[0] === '"');
  const text = line => { const token = quoted(line); return token ? token.text.slice(1, -1) : undefined; };
  function setText(line, value) {
    const token = quoted(line), safe = `"${String(value).replace(/"/g, "'")}"`;
    return token ? line.slice(0, token.start) + safe + line.slice(token.end) : line;
  }

  // ---------- controls: word -> options ----------
  // kind: colour (a picker), number (a field), slider, menu (choices), words (free text), box (x,y,w,h),
  // colours (one picker per bar or slice). `unset` is what the control shows, greyed, while the option is not set.
  const colour = (name, unset = '#ffffff') => ({ name, kind: 'colour', unset });
  const number = (name, unset = '', min = 0, max = 4000, step = 1) => ({ name, kind: 'number', unset, min, max, step });
  const slider = (name, unset, min, max, step) => ({ name, kind: 'slider', unset, min, max, step });
  const menu = (name, choices, unset = choices[0]) => ({ name, kind: 'menu', choices, unset });
  const words = (name, unset = '') => ({ name, kind: 'words', unset });
  const onOff = (name, unset = 'off') => menu(name, ['on', 'off'], unset);

  const MOVES = ['none', 'fade', 'rise', 'lift', 'pop', 'slide-l', 'slide-r', 'blur', 'wipe', 'type', 'grow'];
  const EASES = ['out', 'inout', 'back', 'linear', 'expo', 'spring'];
  const WEIGHTS = ['400', '500', '600', '700', '800', '900'];
  const STACKS = ['sans', 'serif', 'mono', 'rounded', 'display', 'condensed'];   // the fonts of a file with scenes
  const ICONS = ['shield', 'shield-check', 'shield-lock', 'user-check', 'users', 'lock', 'gear', 'handshake', 'fingerprint', 'file', 'file-lock', 'share', 'clipboard', 'check', 'plus', 'info'];
  // probe: the value used to ask the compiler whether it takes the option, when the usual guess would not do
  const at = { ...number('at', '', 0, 600, .1), probe: '0' }, dur = { ...number('dur', '', .1, 600, .1), probe: '.2' };

  // Video files: items with a box.
  const families = fonts => menu('font', fonts, 'Inter');
  const video = fonts => {
    const box = { name: 'box', kind: 'box', unset: '' }, show = [slider('opacity', 1, 0, 1, .05), at, dur, menu('in', MOVES), menu('out', MOVES)];
    return {
      motion: [number('fps', 30, 1, 120)],
      text: [box, number('size', 64, 8, 600), menu('weight', WEIGHTS, '700'), families(fonts), colour('color'), menu('align', ['left', 'center', 'right']), colour('emph', '#ffe600'), colour('bg', '#000000'),
        number('radius', 0, 0, 400), number('pad', 0, 0, 200), words('stroke'), words('shadow'), words('border'), ...show],
      rect: [box, colour('color'), number('radius', 0, 0, 600), words('border'), words('shadow'), ...show],
      image: [box, menu('fit', ['contain', 'cover', 'fill']), colour('bg', '#000000'), number('radius', 0, 0, 600), words('border'), words('shadow'), ...show],
      video: [box, menu('fit', ['contain', 'cover', 'fill']), number('radius', 0, 0, 600), number('trim', 0, 0, 3600, .1), number('rate', 1, .1, 10, .1), onOff('sound'), slider('volume', 1, 0, 1, .05), onOff('loop'), at, dur],
      audio: [slider('volume', 1, 0, 1, .05), menu('bus', ['voice', 'music', 'sfx']), at, dur],
      group: [box, colour('bg', '#000000'), number('radius', 0, 0, 600), onOff('clip'), ...show],
      // animation lines under an item
      to: [number('x', 0, -4000), number('y', 0, -4000), number('scale', 1, 0, 10, .05), number('rotate', 0, -720, 720), slider('opacity', 1, 0, 1, .05), at, dur, menu('ease', EASES)],
      pop: [number('scale', 0, 0, 10, .05), number('rotate', 0, -720, 720), at, dur], count: [number('from', 0, -1e9, 1e9), number('to', 100, -1e9, 1e9), words('format', '{}'), at, dur],
      pulse: [number('scale', 1.12, 0, 10, .01), number('times', 3, 1, 100), at, dur], shake: [number('x', 10, -400, 400), number('y', 0, -400, 400), number('times', 3, 1, 100), at, dur],
      wipe: [menu('dir', ['r', 'l', 'u', 'd']), at, dur], spin: [number('deg', 360, -3600, 3600), at, dur], punch: [number('scale', 1.12, 0, 10, .01), at, dur],
    };
  };
  // Files with scenes: every element that is a box on the page takes STYLE and TIMING; each word adds its own.
  const STYLE = [colour('color'), menu('font', STACKS), number('size', '', 8, 400), menu('weight', WEIGHTS, '700'), menu('align', ['left', 'center', 'right']),
    number('x', 0, -2000, 2000), number('y', 0, -2000, 2000), number('w', '', 0, 2000), number('h', '', 0, 2000), slider('rotate', 0, -180, 180, 1), slider('opacity', 1, 0, 1, .05),
    colour('bg', '#000000'), number('pad', 0, 0, 200), number('radius', 0, 0, 200), words('border'), words('shadow'), { ...words('spacing'), probe: '2px' }, onOff('upper')];
  const TIMING = [at, dur, menu('in', MOVES), menu('ease', EASES), number('stagger', .05, 0, 5, .01)];
  const CHART = [words('title'), words('labels'), { name: 'colors', kind: 'colours', unset: '' }, colour('label-color'), colour('value-color'), number('label-size', '', 6, 80), number('value-size', '', 6, 120), onOff('values', 'on'), onOff('grid')];
  const OWN = {
    bars: [...CHART, words('peak'), words('low'), menu('tone', ['neutral', 'good', 'bad']), colour('bar', '#6ea8ff'), colour('peak-color', '#ffe600'), colour('low-color', '#ffe600'), number('gap', '', 0, 200), words('tag'), { ...words('tag-at'), probe: '1' }],
    line: [...CHART, words('unit'), colour('stroke', '#06d6a0'), onOff('fill'), onOff('dots', 'on')], donut: [...CHART, slider('hole', .5, 0, 1, .05)],
    card: [menu('icon', ICONS), words('label'), words('sub')], panel: [words('header'), onOff('soft'), onOff('tint'), onOff('big')],
    outcome: [words('label'), menu('icon', ICONS)], bullets: [onOff('dots', 'on')], image: [menu('fit', ['cover', 'contain'])], cover: [words('sub'), words('note')], divider: [number('chapter', '', 1, 99)],
    hub: [words('left'), words('right'), menu('lefticon', ICONS), menu('righticon', ICONS)],
  };
  // Drawn things take only their own options.
  const DRAWN = {
    mascot: [menu('kind', ['owl', 'robot', 'fox', 'cat']), colour('color', '#58cc02'), number('size', 1, .2, 3, .05), slider('x', .5, 0, 1, .01), menu('mood', ['neutral', 'happy', 'sad', 'surprised', 'angry', 'sleepy', 'love'])],
    act: [at, dur, words('text')], stage: [words('bg'), at], orb: [menu('color', ['blue', 'orange', 'green', 'purple', 'pink']), number('spin', .5, 0, 5, .1), at, dur],
  };
  const LINES = {   // the two lines that are not elements
    motion: [colour('accent', '#7c5cff'), menu('mode', ['dark', 'light']), menu('font', STACKS), menu('look', ['midnight', 'paper', 'neon']), menu('transition', ['fade', 'slide', 'zoom', 'wipe', 'none']),
      menu('build', ['fade', 'rise', 'pop', 'blur', 'lift', 'wipe', 'none']), onOff('present'), onOff('numbers'), onOff('loop'), number('speed', 1, .3, 4, .1)],
    scene: [words('bg'), slider('dim', 0, 0, 1, .05), menu('in', ['fade', 'slide', 'zoom', 'wipe', 'none']), menu('out', ['fade', 'none']), menu('layout', ['stack', 'columns', 'left']),
      menu('align', ['left', 'center', 'right'], 'center'), menu('valign', ['top', 'center', 'bottom'], 'center')],
  };
  const BOXES = ['eyebrow', 'title', 'sub', 'text', 'count', 'bars', 'line', 'donut', 'heading', 'lede', 'note', 'banner', 'card', 'panel', 'row', 'col', 'grid', 'steps', 'outcome', 'bullets', 'image', 'hub', 'cover', 'divider', 'plus', 'table', 'tabs', 'legend', 'shape'];
  // The controls for a word. scenes: the file has scene blocks. fonts: the named families of a video page.
  function controls(word, scenes, fonts = ['Inter']) {
    if (!scenes) return video(fonts)[word] || [];
    return LINES[word] || DRAWN[word] || (BOXES.includes(word) ? [...(OWN[word] || []), ...STYLE, ...TIMING] : []);
  }

  // ---------- the Add menu ----------
  // Ready lines with sensible values, one set for each kind of file. W and H are the size of the piece; a line that
  // starts with two spaces goes under the one before it. null: that kind of file has no such thing. block: the
  // lines are a scene of their own, not something inside one. needs: a line the file must have at its top.
  const ADD = [
    { title: 'Text', scenes: () => ['text "New text"'], video: (W, H) => [`text "New text" at=0 box=${Math.round(W * .1)},${Math.round(H * .42)},${Math.round(W * .8)},${Math.round(H * .16)} size=${Math.round(H * .09)} align=center in=rise`] },
    { title: 'Title', scenes: () => ['title "New title" in=rise'], video: (W, H) => [`text "New title" at=0 box=${Math.round(W * .08)},${Math.round(H * .1)},${Math.round(W * .84)},${Math.round(H * .2)} size=${Math.round(H * .13)} weight=900 align=center in=rise`] },
    { title: 'Counter', scenes: () => ['count "Signups" 4800'],
      video: (W, H) => [`text "0" at=0 box=${Math.round(W * .2)},${Math.round(H * .36)},${Math.round(W * .6)},${Math.round(H * .28)} size=${Math.round(H * .2)} weight=900 color=#ffe600 align=center`, '  count from=0 to=4800 dur=2 format="{n:,}"'] },
    { title: 'Bar chart', scenes: () => ['bars 12 18 15 22 30 labels=Mon,Tue,Wed,Thu,Fri peak="BEST DAY"'], video: () => ["c.bars [12, 18, 15, 22, 30] ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] at=0 badge='BEST DAY'"], needs: 'import "orb:std/charts" as c' },
    { title: 'Line chart', scenes: () => ['line 3 5 4 8 7 12 labels=Jan,Feb,Mar,Apr,May,Jun'], video: null },
    { title: 'Image or video', file: true },
    { title: 'Slide (a new scene)', scenes: () => ['scene 5s', '  heading "New slide"', '  lede "Say one thing here."'], video: null, block: true },
    { title: 'Character', scenes: () => ['stage at=0', '  mascot "Hoot" color=#58cc02 x=0.5', '  act "Hoot" wave at=0.5 dur=2'], video: null },
    { title: 'Shape', scenes: () => ['shape circle size=160 color=#6ea8ff'], video: (W, H) => [`rect at=0 box=${Math.round(W * .4)},${Math.round(H * .3)},${Math.round(W * .2)},${Math.round(W * .2)} color=#6ea8ff radius=${Math.round(W * .1)} in=pop`] },
  ];
  // The file to start from when the editor is empty.
  const STARTER = { scenes: ['motion "Untitled" 1280x720 5s accent=#7c5cff', '  scene 5s'], video: ['motion "Untitled" 16:9 6s', '  rect at=0 color=#0b0f1a'] };

  return { parse, get, set, remove, text, setText, controls, ADD, STARTER };
})();
if (typeof module === 'object' && module.exports) module.exports = OrbEdit;
