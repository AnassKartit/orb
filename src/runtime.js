(function () {
  const M = window.__PRISM__;
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const EASE = {
    linear: x => x,
    out: x => 1 - Math.pow(1 - x, 3),
    inout: x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    back: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  // Easing by name: out inout back linear expo spring spring(n) in(n) out(n) inOut(n)
  const easeBy = (name) => {
    if (EASE[name]) return EASE[name];
    let m;
    if (name === 'expo') return x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
    if ((m = name.match(/^spring(?:\(([\d.]+)\))?$/))) { const k = m[1] ? parseFloat(m[1]) : 9; return x => (x >= 1 ? 1 : 1 - Math.exp(-6.2 * x) * Math.cos(k * x * 1.15)); }
    if ((m = name.match(/^(in|out|inOut)\(([\d.]+)\)$/))) {
      const n = parseFloat(m[2]);
      if (m[1] === 'in') return x => Math.pow(x, n);
      if (m[1] === 'out') return x => 1 - Math.pow(1 - x, n);
      return x => (x < 0.5 ? Math.pow(2 * x, n) / 2 : 1 - Math.pow(2 * (1 - x), n) / 2);
    }
    return EASE.out;
  };
  const stage = document.getElementById('stage');
  document.body.dataset.theme = M.theme;
  stage.style.width = M.w + 'px';
  stage.style.height = M.h + 'px';

  const h = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
  const s = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const chartBox = (host, el) => { const box = h('div', 'el chartbox', host); if (el.named.title) h('div', 'caption', box).textContent = el.named.title; return box; };
  const color = (i) => `var(--d${(i % 5) + 1})`;

  // Drifting background light, a function of time like everything else.
  const blobs = [0, 1, 2].map(i => {
    const b = h('div', 'blob', stage);
    const size = M.w * [0.34, 0.3, 0.26][i];
    b.style.cssText = `width:${size * 1.7}px;height:${size * 1.7}px;background:${(c => `radial-gradient(closest-side, color-mix(in srgb, ${c} 100%, transparent) 0%, color-mix(in srgb, ${c} 58%, transparent) 30%, color-mix(in srgb, ${c} 22%, transparent) 62%, color-mix(in srgb, ${c} 6%, transparent) 85%, transparent 100%)`)(['var(--vio)', 'var(--acc)', 'var(--c3)'][i])}`;
    return b;
  });
  function drawBackground(t) {
    blobs.forEach((b, i) => {
      const x = M.w * [0.04, 0.98, 0.5][i] + Math.sin(t * 0.3 + i * 2) * M.w * 0.05;
      const y = M.h * [0.06, 0.96, 0.55][i] + Math.cos(t * 0.25 + i) * M.h * 0.06;
      b.style.transform = `translate3d(${x - parseFloat(b.style.width) / 2}px,${y - parseFloat(b.style.height) / 2}px,0)`;
    });
  }

  function applyIn(node, kind, p) {
    const e = p;
    switch (kind) {
      case 'fade': node.style.opacity = e; break;
      case 'lift': node.style.opacity = e; node.style.transform = `translateY(${(1 - e) * 26}px)`; break;
      case 'wipe': node.style.opacity = 1; node.style.clipPath = e >= 1 ? 'none' : `inset(0 ${(1 - e) * 100}% 0 0)`; break;
      case 'none': break;
      case 'rise': node.style.opacity = e; node.style.transform = `translateY(${(1 - e) * 46}px)`; break;
      case 'pop': node.style.opacity = clamp(p * 2); node.style.transform = `scale(${0.55 + 0.45 * e})`; break;
      case 'slide-l': node.style.opacity = e; node.style.transform = `translateX(${(1 - e) * -120}px)`; break;
      case 'slide-r': node.style.opacity = e; node.style.transform = `translateX(${(1 - e) * 120}px)`; break;
      case 'blur': node.style.opacity = e; node.style.filter = `blur(${(1 - e) * 18}px)`; break;
      default: node.style.opacity = p > 0 ? 1 : 0;
    }
  }

  const imgSrc = v => (v && v[0] === '@' ? (M.assets || {})[v.slice(1)] : v) || '';
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[\[(.+?)\]\]/g, '<u>$1</u>').replace(/\^\(([^)]*)\)/g, '<sup>$1</sup>');
  const ICONS = {
    shield: 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z',
    'shield-check': 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z M8.5 12l2.5 2.5 4.5-4.5',
    'shield-lock': 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z M9.5 11.5h5v4h-5z M10.5 11.5v-1.5a1.5 1.5 0 0 1 3 0v1.5',
    'user-check': 'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M16 11l2 2 4-4',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
    lock: 'M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    handshake: 'M11 17l2 2a1.5 1.5 0 0 0 2-2 M14 14l2.5 2.5a1.5 1.5 0 0 0 2-2L15 11 M3 11l4-4 4 1 4-1 4 4 M3 11l5 5a1.5 1.5 0 0 0 2-2 M2 13l2 1 M22 13l-2 1',
    fingerprint: 'M12 11c0 3.5-.5 6-1.5 8 M8.5 14.5C9 16 8.8 17.5 8 19 M15.5 9a4 4 0 0 0-7 2 M12 3a8 8 0 0 1 8 8v3 M4 11a8 8 0 0 1 3-6.2 M17 14c0 3-.5 5-1.5 7',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
    'file-lock': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6v4H9z M10 15v-1.2a2 2 0 0 1 4 0V15',
    share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7 M16 6l-4-4-4 4 M12 2v13',
    clipboard: 'M9 2h6v4H9z M7 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2 M8 13l2 2 4-4',
    check: 'M5 12l5 5L20 7', plus: 'M12 5v14 M5 12h14', info: 'M12 8h.01 M11 12h1v5h1 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
    sharepoint: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M9 9h5a2 2 0 0 1 0 4H9.5a2 2 0 0 0 0 4H15',
    purview: 'M12 3l8 5v8l-8 5-8-5V8z M12 8l4 2.5v3L12 16l-4-2.5v-3z',
  };
  const disc = (name, host) => {
    const d = h('span', 'disc', host);
    d.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.shield}"/></svg>`;
    return d;
  };
  const kitText = (cls, el, host) => { const n = h('div', 'el ' + cls + (el.named.tone === 'blue' ? ' blue' : '') + (el.named.size === 's' ? ' s' : ''), host); n.innerHTML = md(el.text[0]); return { node: n, text: null }; };
  const builders = {
    eyebrow: (el, host) => textEl('eyebrow', el, host),
    rule(el, host) { const n = h('div', 'el rule', host); return p => { n.style.opacity = p; n.style.transform = `scaleX(${p})`; }; },
    title(el, host) {
      if (el.in !== 'rise') return textEl('title', el, host);
      const node = h('div', 'el title', host);
      const words = el.text[0].split(' ');
      const spans = words.map((w, i) => {
        const sp = h('span', 'w' + (i === words.length - 1 && words.length > 1 ? ' last' : ''), node);
        sp.textContent = w;
        if (i < words.length - 1) node.append(' ');
        return sp;
      });
      return p => {
        node.style.opacity = 1;
        spans.forEach((sp, i) => {
          const q = EASE.out(clamp(p * (spans.length + 1.2) - i * 0.9));
          sp.style.opacity = q;
          sp.style.transform = `translateY(${(1 - q) * 0.6}em)`;
          sp.style.filter = q < 1 ? `blur(${(1 - q) * 10}px)` : '';
        });
      };
    },
    sub: (el, host) => textEl('sub', el, host),
    text: (el, host) => textEl('text', el, host),
    count(el, host) {
      const box = h('div', 'el count', host);
      const num = h('div', 'num', box);
      h('div', 'lbl', box).textContent = el.text[0];
      const m = el.args[0].match(/^([^\d-]*)(-?[\d.,]+)(.*)$/) || ['', '', el.args[0], ''];
      const target = parseFloat(m[2].replace(/,/g, '')) || 0;
      const dec = (m[2].split('.')[1] || '').length;
      const show = v => Math.abs(target) >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
      return p => { num.textContent = m[1] + show(target * p) + m[3]; box.style.opacity = clamp(p * 4); box.style.transform = `scale(${1 + 0.05 * Math.sin(Math.PI * clamp((p - 0.82) / 0.18))})`; };
    },
    bars(el, host) {
      const raw = el.args.filter(a => Number.isFinite(parseFloat(a)));
      const vals = raw.map(parseFloat);
      const labels = el.named.labels ? el.named.labels.split(',') : null;
      const W = el.w || 760, H = 300, gap = 18, PT = (el.named.peak || el.named.low) ? 86 : 44, PB = labels ? 38 : 14, n = vals.length;
      const bw = (W - gap * (n + 1)) / n, max = Math.max(...vals), useLow = el.named.low !== undefined,
        top = useLow ? vals.indexOf(Math.min(...vals)) : vals.indexOf(max), base = PT + H, tag = useLow ? el.named.low : el.named.peak;
      const svg = s('svg', { viewBox: `0 0 ${W} ${PT + H + PB}`, width: W, height: PT + H + PB }, chartBox(host, el));
      const defs = s('defs', {}, svg);
      const id = 'bg' + el.line;
      const g = s('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      s('stop', { offset: 0, style: 'stop-color:var(--c1)' }, g);
      s('stop', { offset: 1, style: 'stop-color:var(--c2)' }, g);
      const gh = s('linearGradient', { id: id + 'h', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      const tv = el.named.tone === 'good' ? 'good' : el.named.tone === 'bad' ? 'bad' : 'hl';
      s('stop', { offset: 0, style: `stop-color:var(--${tv}1)` }, gh);
      s('stop', { offset: 1, style: `stop-color:var(--${tv}2)` }, gh);
      const glow = s('filter', { id: id + 'f', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
      s('feGaussianBlur', { stdDeviation: 10 }, glow);
      s('line', { x1: gap, x2: W - gap, y1: base, y2: base, stroke: 'rgba(255,255,255,.16)', 'stroke-width': 2 }, svg);
      const cx = i => gap + i * (bw + gap) + bw / 2;
      // cheap glow: layered translucent strokes (no filters, so nothing is re-blurred each frame)
      const glows = vals.map((v, i) => [[22, 0.07], [12, 0.12]].map(([w, o]) => s('rect', { x: gap + i * (bw + gap), rx: 12, width: bw, fill: 'none', stroke: i === top ? `var(--${tv}1)` : 'var(--c1)', 'stroke-width': w * (i === top ? 1 : 0.6), 'stroke-opacity': o * (i === top ? 1.6 : 1) }, svg)));
      const rects = vals.map((v, i) => {
        const r = s('rect', { x: gap + i * (bw + gap), rx: 10, width: bw, fill: `url(#${i === top ? id + 'h' : id})`, opacity: i === top ? 1 : 0.85 }, svg);
        return r;
      });
      const gloss = vals.map((v, i) => s('rect', { x: gap + i * (bw + gap) + bw * 0.12, rx: 6, width: bw * 0.2, fill: '#fff', opacity: 0.16 }, svg));
      const fmtVal = (r, v) => v >= 1000 ? v.toLocaleString('en-US') : r;
      const txt = (str, attrs) => { const t = s('text', { 'text-anchor': 'middle', ...attrs }, svg); t.textContent = str; return t; };
      const valTx = vals.map((v, i) => txt(fmtVal(raw[i], v), { x: cx(i), 'font-size': 22, 'font-weight': 700, fill: i === top ? 'var(--fg)' : 'var(--muted)', opacity: 0 }));
      if (labels) labels.forEach((l, i) => txt(l, { x: cx(i), y: base + 28, 'font-size': 20, fill: 'var(--muted)' }));
      const pw = tag ? tag.length * 11 + 28 : 0;
      const pill = tag ? s('rect', { x: cx(top) - pw / 2, width: pw, height: 28, rx: 14, fill: `var(--${tv}1)`, opacity: 0 }, svg) : null;
      const peakTx = tag ? txt(tag, { x: cx(top), 'font-size': 14, 'font-weight': 800, 'letter-spacing': '.16em', fill: '#1a1208', opacity: 0 }) : null;
      return (p, lt) => {
        rects.forEach((r, i) => {
          const order = el.named.from === 'center' ? Math.round(Math.abs(i - (n - 1) / 2)) : el.named.from === 'last' ? n - 1 - i : i;
          const q = easeBy(el.ease || 'back')(clamp((lt - order * el.stagger) / el.dur));
          const bh = (v => v / max * (H - 8))(vals[i]) * Math.max(q, 0);
          r.setAttribute('height', bh); r.setAttribute('y', base - bh);
          glows[i].forEach(g => { g.setAttribute('height', bh); g.setAttribute('y', base - bh); });
          gloss[i].setAttribute('height', Math.max(bh - 16, 0)); gloss[i].setAttribute('y', base - bh + 8);
          valTx[i].setAttribute('y', base - bh - 10);
          valTx[i].setAttribute('opacity', clamp((q - 0.6) * 2.5));
          if (i === top) {
            if (peakTx) { const o = clamp((q - 0.7) * 3.3); pill.setAttribute('y', base - bh - 68); pill.setAttribute('opacity', o); peakTx.setAttribute('y', base - bh - 49); peakTx.setAttribute('opacity', o); }
          }
        });
      };
    },
    line(el, host) {
      const raw = el.args.filter(a => Number.isFinite(parseFloat(a)));
      const vals = raw.map(parseFloat), n = vals.length;
      const labels = el.named.labels ? el.named.labels.split(',') : null;
      const W = el.w || 760, H = 260, PL = 56, PR = 40, PT = 40, PB = labels ? 40 : 18;
      const mx = Math.max(...vals), mn = Math.min(...vals), span = (mx - mn) || 1;
      const nice = x => { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
      const step = nice((span * 1.3) / 3);
      const lo = (mn >= 0 ? Math.max(0, Math.floor((mn - span * 0.1) / step) * step) : Math.floor((mn - span * 0.1) / step) * step), hi = Math.ceil((mx + span * 0.1) / step) * step;
      const ticks = []; for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
      const unit = el.named.unit || ((el.named.title || '').includes('%') ? '%' : '');
      const X = i => PL + 30 + i * (W - PL - PR - 30) / (n - 1), Y = v => PT + H - (v - lo) / (hi - lo) * H;
      const pts = vals.map((v, i) => [X(i), Y(v)]);
      const svg = s('svg', { viewBox: `0 0 ${W} ${PT + H + PB}`, width: W, height: PT + H + PB }, chartBox(host, el));
      const id = 'lg' + el.line;
      const defs = s('defs', {}, svg);
      const g = s('linearGradient', { id, x1: 0, x2: 1 }, defs);
      s('stop', { offset: 0, style: 'stop-color:var(--c1)' }, g);
      s('stop', { offset: 1, style: 'stop-color:var(--c5)' }, g);
      const ag = s('linearGradient', { id: id + 'a', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      s('stop', { offset: 0, style: 'stop-color:var(--c3);stop-opacity:.38' }, ag);
      s('stop', { offset: 1, style: 'stop-color:var(--c3);stop-opacity:0' }, ag);
      const txt = (str, attrs) => { const t = s('text', attrs, svg); t.textContent = str; return t; };
      const fmtTick = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
      ticks.forEach(v => {
        const y = Y(v);
        s('line', { x1: PL, x2: W - PR, y1: y, y2: y, stroke: 'rgba(255,255,255,.08)', 'stroke-width': 2 }, svg);
        txt(fmtTick(v) + unit, { x: PL - 10, y: y + 6, 'text-anchor': 'end', 'font-size': 16, fill: 'var(--muted)' });
      });
      if (labels) labels.forEach((l, i) => txt(l, { x: X(i), y: PT + H + 28, 'text-anchor': 'middle', 'font-size': 18, fill: 'var(--muted)' }));
      let d = `M${pts[0][0]},${pts[0][1]}`;
      for (let i = 1; i < n; i++) { const mxp = (pts[i - 1][0] + pts[i][0]) / 2; d += ` C${mxp},${pts[i - 1][1]} ${mxp},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`; }
      const area = s('path', { d: d + ` L${pts[n - 1][0]},${PT + H} L${pts[0][0]},${PT + H} Z`, fill: `url(#${id}a)`, opacity: 0 }, svg);
      const path = s('path', { d, fill: 'none', stroke: `url(#${id})`, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      const keyIdx = new Set(n <= 8 ? vals.map((_, i) => i) : [0, n - 1, vals.indexOf(mx), vals.indexOf(mn)]);
      const dots = pts.map(([x, y], i) => s('circle', { cx: x, cy: y, r: 0, fill: 'var(--fg)', stroke: 'var(--bg1)', 'stroke-width': 3 }, svg));
      const vtx = [...keyIdx].map(i => ({ i, t: txt(fmtTick(vals[i]) + unit, { x: pts[i][0], y: pts[i][1] - 16, 'text-anchor': 'middle', 'font-size': 19, 'font-weight': 700, fill: 'var(--fg)', opacity: 0 }) }));
      const len = path.getTotalLength ? path.getTotalLength() : 1000;
      path.style.strokeDasharray = len;
      return p => {
        path.style.strokeDashoffset = len * (1 - p);
        area.setAttribute('opacity', clamp((p - 0.4) * 1.8));
        dots.forEach((c, i) => c.setAttribute('r', 6.5 * clamp((p - i / (n - 1)) * 8 + 0.05) * (p > i / (n - 1) ? 1 : 0)));
        vtx.forEach(({ i, t }) => t.setAttribute('opacity', clamp((p - i / (n - 1)) * 6)));
      };
    },
    donut(el, host) {
      const keys = Object.keys(el.named).filter(k => k !== 'title' && Number.isFinite(parseFloat(el.named[k])));
      const vals = keys.map(k => parseFloat(el.named[k]));
      const total = vals.reduce((a, b) => a + b, 0);
      const pct = vals.map(v => Math.round(v / total * 100));
      const R = 105, SW = 42, C = 2 * Math.PI * R;
      const box = chartBox(host, el);
      const svg = s('svg', { viewBox: '-150 -150 300 300', width: el.w || 340, height: el.w || 340 }, box);
      s('circle', { r: R, fill: 'none', stroke: 'rgba(255,255,255,.07)', 'stroke-width': SW }, svg);
      let off = 0;
      const big = vals.indexOf(Math.max(...vals));
      const arcs = vals.map((v, i) => {
        const len = (v / total) * C, start = off; off += len;
        const c = s('circle', { r: R, fill: 'none', stroke: color(i), 'stroke-width': SW, transform: 'rotate(-90)' }, svg);
        const a = (start + len / 2) / C * 2 * Math.PI - Math.PI / 2;
        const lab = pct[i] >= 8 ? s('text', { x: R * Math.cos(a), y: R * Math.sin(a) + 7, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#fff', opacity: 0 }, svg) : null;
        if (lab) lab.textContent = pct[i] + '%';
        return { c, len, start, lab };
      });
      const cen = s('text', { 'text-anchor': 'middle', y: 6, 'font-size': 52, 'font-weight': 800, fill: 'var(--fg)', opacity: 0 }, svg);
      cen.textContent = pct[big] + '%';
      const cenL = s('text', { 'text-anchor': 'middle', y: 34, 'font-size': 15, 'font-weight': 700, 'letter-spacing': '.2em', fill: 'var(--muted)', opacity: 0 }, svg);
      cenL.textContent = keys[big].toUpperCase();
      const legend = h('div', 'legend', box);
      keys.forEach((k, i) => { const l = h('span', '', legend); l.innerHTML = `<i style="background:${color(i)}"></i>${k} <b>${pct[i]}%</b>`; });
      return p => {
        const shown = p * C;
        arcs.forEach(a => {
          const vis = clamp(shown - a.start, 0, a.len);
          a.c.setAttribute('stroke-dasharray', `${vis} ${C - vis}`);
          a.c.setAttribute('stroke-dashoffset', -a.start);
          if (a.lab) a.lab.setAttribute('opacity', clamp((shown - a.start - a.len * 0.55) / (a.len * 0.25)));
        });
        const o = clamp((p - 0.7) * 3.3);
        cen.setAttribute('opacity', o); cenL.setAttribute('opacity', o);
        legend.style.opacity = clamp((p - 0.5) * 2.5);
      };
    },
    orb(el, host) {
      const size = parseFloat(el.named.size) || 420;
      const canvas = h('canvas', 'el', host);
      canvas.width = canvas.height = size * 2;
      canvas.style.width = canvas.style.height = size + 'px';
      const R = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      R.setSize(size * 2, size * 2, false);
      R.setClearColor(0x000000, 0);
      const slots = { blue: 1, orange: 2, aqua: 3, yellow: 4, magenta: 5 };
      const name = el.named.color || 'blue';
      const css = getComputedStyle(document.body);
      const col = new THREE.Color(slots[name] ? css.getPropertyValue('--d' + slots[name]).trim() : name);
      const spin = el.named.spin !== undefined ? parseFloat(el.named.spin) : 0.5;
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      const group = new THREE.Group();
      scene.add(group);
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 4),
        new THREE.MeshStandardMaterial({ color: col, metalness: 0.15, roughness: 0.42, emissive: col, emissiveIntensity: 0.18 }));
      const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.34, 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.16 }));
      group.add(core, wire);
      scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x0b1020, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 4, 5); scene.add(key);
      const rim = new THREE.PointLight(col, 0.9, 20); rim.position.set(-4, -2, -3); scene.add(rim);
      // Deterministic particle shell (seeded), so every frame is a pure function of time.
      let seed = (el.line * 2654435761) >>> 0;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const n = el.named.particles !== undefined ? parseInt(el.named.particles, 10) : 300;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = 2.2 + rnd() * 2.6, a = rnd() * Math.PI * 2, b = Math.acos(2 * rnd() - 1);
        pos.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dust = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.035, color: 0xffffff, transparent: true, opacity: 0.7 }));
      scene.add(dust);
      return (p, lt) => {
        const t = Math.max(lt, 0);
        group.rotation.y = t * spin;
        group.rotation.x = Math.sin(t * 0.6) * 0.25;
        group.scale.setScalar(1 + 0.03 * Math.sin(t * 2));
        dust.rotation.y = -t * spin * 0.35;
        cam.position.set(Math.sin(t * 0.25) * 0.6, 0.4, 6.6 - 1.4 * p);
        cam.lookAt(0, 0, 0);
        R.render(scene, cam);
      };
    },


    tabs(el, host) { const t = h('div', 'el tabs', host); el.text.forEach((x, i) => { h('span', 'tab' + (i === el.text.length - 1 ? ' on' : ''), t).textContent = x; }); },
    legend(el, host) { const g = h('div', 'el legendbar', host); h('b', '', g).textContent = 'LEGEND'; el.text.forEach(x => { h('span', 'chip', g).innerHTML = md(x).replace(/^(\d+\.)/, '<b>$1</b>'); }); },
    table(el, host, add) {
      const w = h('div', 'el tbl', host);
      if (el.named.rail) h('div', 'rail', w).textContent = el.named.rail;
      const cols = h('div', 'tcols', w);
      el.children.forEach((c, i) => {
        const cc = h('div', 'tcol', cols), hd = h('div', 'th', cc);
        hd.textContent = c.named.header || ''; hd.style.backgroundPosition = `${i * 50}% 0`;
        const body = h('div', 'tbody', cc); (c.children || []).forEach(k => add(k, body));
      });
    },
    // ---------------- slide kit ----------------
    heading: (el, host) => kitText('heading', el, host),
    lede: (el, host) => kitText('lede', el, host),
    note: (el, host) => kitText('note', el, host),
    panel(el, host, add) {
      const box = h('div', 'el panel' + (el.named.soft !== undefined ? ' soft' : ''), host);
      if (el.named.w) box.style.flex = el.named.w;
      if (el.named.header) h('div', 'hdr' + (el.named.tint !== undefined ? ' tint' : '') + (el.named.big !== undefined ? ' big' : ''), box).textContent = el.named.header;
      const body = h('div', 'pbody col', box); body.style.flex = '1';
      el.children.forEach(c => add(c, body));
    },
    grid(el, host, add) {
      const g = h('div', 'el grid', host);
      g.style.gridTemplateColumns = `repeat(${parseInt(el.args[0], 10) || 2}, 1fr)`;
      if (el.named.w) g.style.flex = el.named.w;
      el.children.forEach(c => add(c, g));
    },
    row(el, host, add) { const r = h('div', 'el row' + (el.named.top !== undefined ? ' top' : ''), host); if (el.named.w) r.style.flex = el.named.w; el.children.forEach(c => add(c, r)); },
    col(el, host, add) { const c = h('div', 'el col', host); if (el.named.w) c.style.flex = el.named.w; c.style.justifyContent = el.named.align || 'flex-start'; el.children.forEach(k => add(k, c)); },
    card(el, host) {
      const c = h('div', 'el card', host);
      if (el.named.w) c.style.flex = el.named.w;
      if (el.named.icon) disc(el.named.icon, c);
      if (el.named.label) h('div', 'lbl', c).textContent = el.named.label;
      if (el.named.sub) { const t = h('div', 'subtxt', c); t.innerHTML = md(el.named.sub); t.style.fontWeight = 600; }
      h('div', 'ctext', c).innerHTML = md(el.text[0]);
    },
    steps(el, host) {
      const ol = h('ol', 'el steps', host);
      const lis = el.text.map((t, i) => { const li = h('li', '', ol); h('span', 'badge', li).textContent = i + 1; h('span', '', li).innerHTML = md(t); return li; });
      return p => lis.forEach((li, i) => { const q = clamp(p * lis.length - i); li.style.opacity = q; li.style.transform = `translateX(${(1 - q) * -18}px)`; });
    },
    outcome(el, host) {
      const o = h('div', 'el outcome', host);
      h('div', 'pill', o).textContent = el.named.label || 'Outcome';
      const r = h('div', 'orow', o);
      disc(el.named.icon || 'shield', r);
      h('span', '', r).innerHTML = md(el.text[0]);
    },
    bullets(el, host) {
      const ul = h('ul', 'el checks ' + (el.named.size || '') + (el.named.dots ? ' dots' : ''), host);
      if (el.named.w) ul.style.flex = el.named.w;
      const lis = el.text.map(t => {
        const li = h('li', t.startsWith('- ') ? 'subi' : t.startsWith('# ') ? 'h' : '', ul);
        li.innerHTML = md(t.replace(/^(- |# )/, '')); return li;
      });
      return p => lis.forEach((li, i) => { const q = clamp(p * (lis.length + 1.5) - i * 0.9); li.style.opacity = q; li.style.transform = `translateY(${(1 - q) * 10}px)`; });
    },
    banner: (el, host) => { const b = h('div', 'el banner', host); b.textContent = el.text[0]; },
    plus(el, host) { h('div', 'el plus', host).textContent = '+'; },
    image(el, host) { const i = h('img', 'el imgfx', host); i.src = imgSrc(el.named.image); if (el.named.w) i.style.width = el.named.w + 'px'; },
    hub(el, host) {
      const wrap = h('div', 'el hub', host);
      const side = (txt, ic) => { const d = h('div', 'side', wrap); if (ic) disc(ic, d); h('div', '', d).textContent = txt; return d; };
      if (el.named.left) side(el.named.left, el.named.lefticon);
      const ring = h('div', 'ring', wrap);
      if (el.named.logo) { const lg = h('img', 'rlogo', ring); lg.src = imgSrc(el.named.logo); }
      h('div', 't', ring).textContent = el.text[0];
      if (el.named.right) side(el.named.right, el.named.righticon);
      return p => { ring.style.transform = `scale(${0.8 + 0.2 * p})`; wrap.style.opacity = clamp(p * 2); };
    },
    cover(el, host) {
      if (el.named.variant === 'thanks') {
        const c = h('div', 'el cover thanks', host.parentElement);
        const pnl = h('div', 'tp', c);
        h('div', 'tt', pnl).textContent = el.text[0];
        if (el.named.sub) h('div', 'ss', pnl).innerHTML = md(el.named.sub);
        return { node: c };
      }
      const c = h('div', 'el cover', host.parentElement);
      const lg = h('div', 'lg', c);
      if (el.named.logo) { const im = h('img', 'lockup', lg); im.src = imgSrc(el.named.logo); }
      else if (el.named.brand) h('span', '', lg).textContent = el.named.brand;
      const tx = h('div', 'txt', c);
      h('div', 'tt', tx).textContent = el.text[0];
      if (el.named.sub) h('div', 'ss', tx).textContent = el.named.sub;
      if (el.named.note) h('div', 'ss', tx).textContent = el.named.note;
      if (el.named.image) h('img', '', c).src = imgSrc(el.named.image);
      return { node: c };
    },
    divider(el, host) {
      const d = h('div', 'el divider', host.parentElement);
      if (el.named.chapter) h('div', 'dn', d).textContent = String(el.named.chapter).padStart(2, '0');
      h('div', 'dt', d).textContent = el.text[0];
      if (el.named.image) h('img', '', d).src = imgSrc(el.named.image);
      return { node: d };
    },

    // ---------------- 3D toy world ----------------
    world(el, host) {
      const root = host.parentElement;
      const sky = h('div', 'el worldsky', root);
      const [c1, c2] = (el.named.sky || '#cfe9ff,#fff7ef').split(',');
      sky.style.background = `linear-gradient(180deg, ${c1}, ${c2 || '#fff'})`;
      const cv = h('canvas', 'el worldcv', root);
      cv.width = M.w; cv.height = M.h; cv.style.width = M.w + 'px'; cv.style.height = M.h + 'px';
      if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
      const R = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
      R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
      R.setSize(M.w, M.h, false); R.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(30, M.w / M.h, 0.1, 100);
      scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6a8f58, 0.75));
      const sun = new THREE.DirectionalLight(0xfff0d8, 1.5); sun.position.set(-4, 7, 6); scene.add(sun);
      const fill = new THREE.DirectionalLight(0xbcd8ff, 0.4); fill.position.set(5, 3, 4); scene.add(fill);
      const std = (c, r = 0.62) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: r, metalness: 0 });
      const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
      // ground, soft trees, bench
      const ground = mesh(new THREE.PlaneGeometry(60, 40), std('#7cc05a', 0.95)); ground.rotation.x = -Math.PI / 2; scene.add(ground);
      [[-7, 0, -9, 2.6, '#7fbf6a'], [-2.5, 0, -11, 3.2, '#8ccb73'], [5, 0, -10, 2.9, '#79b865'], [9.5, 0, -8, 2.2, '#8ccb73']].forEach(([x, y, z, r, c]) => {
        scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, 2.2, 12), std('#8a6a4a'), x, 1.1, z));
        scene.add(mesh(new THREE.SphereGeometry(r, 32, 24), std(c, 0.9), x, 2.6 + r * 0.6, z));
      });
      const wood = std('#c98a4b', 0.7);
      scene.add(mesh(new THREE.BoxGeometry(5.6, 0.18, 1.25), wood, 0, 1.0, 0.1));
      scene.add(mesh(new THREE.BoxGeometry(5.6, 0.7, 0.14), wood, 0, 1.62, -0.52));
      [-2.5, 2.5].forEach(x => { scene.add(mesh(new THREE.BoxGeometry(0.2, 1.0, 1.1), std('#a8703a', 0.75), x, 0.5, 0.1)); });
      // toy characters
      const toys = {};
      const kids = el.children || [];
      kids.filter(c => c.type === 'toy').forEach((c, i) => {
        const nm = c.text[0], n = c.named;
        const skin = n.skin || '#d9a37a', shirt = n.shirt || '#2f9aa0', hair = n.hair || '#5b3a29', eyes = n.eyes || '#ff4fd8';
        const g = new THREE.Group(); g.position.set(parseFloat(n.x !== undefined ? n.x : (i ? 1.2 : -1.2)), 1.1, 0.1);
        const body = mesh(new THREE.CapsuleGeometry(0.62, 0.55, 10, 28), std(shirt), 0, 0.95, 0); g.add(body);
        const head = new THREE.Group(); head.position.y = 2.25; g.add(head);
        const skull = mesh(new THREE.SphereGeometry(1, 48, 36), std(skin, 0.55)); skull.scale.set(1.08, 0.98, 1.0); head.add(skull);
        const cap = mesh(new THREE.SphereGeometry(1.03, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.4), std(hair, 0.9)); cap.scale.set(1.08, 1, 1.02); cap.rotation.x = -0.18; head.add(cap);
        if (n.beard === 'on') { const b = mesh(new THREE.SphereGeometry(1.02, 48, 24, 0, Math.PI * 2, Math.PI * 0.68, Math.PI * 0.32), std(hair, 0.9)); b.scale.set(1.09, 1, 1.04); head.add(b); }
        const eyeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(eyes), emissive: new THREE.Color(eyes), emissiveIntensity: 0.85, roughness: 0.3 });
        const eyeL = new THREE.Group(), eyeR = new THREE.Group();
        [[eyeL, -1], [eyeR, 1]].forEach(([e, sx]) => {
          e.position.set(sx * 0.42, 0.08, 0.86); e.add(mesh(new THREE.SphereGeometry(0.24, 24, 20), eyeMat));
          e.add(mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }), sx * 0.07, 0.09, 0.2)); head.add(e);
        });
        const mouth = mesh(new THREE.SphereGeometry(0.2, 24, 16), std('#3a1410', 0.5), 0, -0.34, 0.9); mouth.scale.set(1.1, 0.35, 0.5); head.add(mouth);
        [-1, 1].forEach(sx => {   // antennae
          const st = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.7, 10), std('#3a2a22'), sx * 0.45, 1.15, 0); st.rotation.z = -sx * 0.35;
          const tip = mesh(new THREE.SphereGeometry(0.13, 16, 12), std(hair, 0.8), sx * 0.58, 1.5, 0); head.add(st, tip);
        });
        if (n.flower === 'on') { const f = mesh(new THREE.SphereGeometry(0.14, 12, 10), std('#ff9a3c', 0.5), 0.78, 0.55, 0.45); head.add(f);
          for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; head.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), std('#ffb36b', 0.5), 0.78 + Math.cos(a) * 0.2, 0.55 + Math.sin(a) * 0.2, 0.45)); } }
        const arms = [-1, 1].map(sx => {
          const pv = new THREE.Group(); pv.position.set(sx * 0.7, 1.45, 0.1);
          pv.add(mesh(new THREE.CapsuleGeometry(0.17, 0.5, 8, 16), std(shirt), 0, -0.4, 0.05), mesh(new THREE.SphereGeometry(0.2, 16, 12), std(skin, 0.55), 0, -0.88, 0.1));
          g.add(pv); return pv;
        });
        [-1, 1].forEach(sx => { const l = mesh(new THREE.CapsuleGeometry(0.22, 0.55, 8, 16), std('#d6b98f', 0.8), sx * 0.3, 0.55, 0.55); l.rotation.x = Math.PI / 2; g.add(l);
          g.add(mesh(new THREE.BoxGeometry(0.34, 0.2, 0.46), std('#f2eadc', 0.6), sx * 0.3, 0.38, 1.0)); });
        const shadow = mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshBasicMaterial({ color: 0x20321a, transparent: true, opacity: 0.18 }), 0, -1.08, 0.2); shadow.rotation.x = -Math.PI / 2; g.add(shadow);
        scene.add(g);
        toys[nm] = { g, head, body, arms, eyes: [eyeL, eyeR], mouth, seed: i * 1.7 + 0.4 };
      });
      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, target: c.named.to }));
      const cams = kids.filter(c => c.type === 'camera').sort((a, b) => a.at - b.at);
      const ease = x => 1 - Math.pow(1 - clamp(x), 3);
      function camAt(lt) {
        let push = 1, orbit = 0, rise = 0;
        cams.forEach(c => {
          const k = ease((lt - c.at) / c.dur);
          if (c.named.push !== undefined) push += (parseFloat(c.named.push) - 1) * k;
          if (c.named.orbit !== undefined) orbit += parseFloat(c.named.orbit) * k;
          if (c.named.rise !== undefined) rise += parseFloat(c.named.rise) * k;
        });
        const d = 14.5 / push, a = orbit * Math.PI / 180;
        cam.position.set(Math.sin(a) * d, 3.6 + rise, Math.cos(a) * d);
        cam.lookAt(0, 2.9, 0);
      }
      return (p, lt) => {
        const t = Math.max(lt, 0);
        Object.values(toys).forEach(T => {
          const ph = t * 1.6 + T.seed;
          T.body.scale.y = 1 + 0.018 * Math.sin(ph); T.head.position.y = 2.25 + 0.03 * Math.sin(ph);
          T.head.rotation.set(0.03 * Math.sin(t * 0.7 + T.seed), 0.12 * Math.sin(t * 0.45 + T.seed), 0.025 * Math.sin(t * 0.6 + T.seed));
          T.arms[0].rotation.set(0.05 * Math.sin(ph), 0, -0.12); T.arms[1].rotation.set(0.05 * Math.sin(ph + 1), 0, 0.12);
          const blink = ((t + T.seed) % 3.3) < 0.14 ? 0.08 : 1; T.eyes.forEach(e => e.scale.y = blink);
          T.mouth.scale.y = 0.35;
        });
        acts.forEach(a => {
          const T = toys[a.who]; const k = (lt - a.at) / a.dur; if (!T || k < 0 || k > 1) return;
          const w = Math.sin(Math.PI * k), s = (f) => Math.sin(lt * f);
          if (a.verb === 'talk') { T.mouth.scale.y = 0.35 + 0.65 * Math.abs(s(11)) * w; T.head.rotation.y += 0.1 * s(2.2) * w; T.head.rotation.x += 0.05 * s(5) * w; T.arms[1].rotation.z = 0.12 + 0.55 * Math.max(0, s(3.1)) * w; T.arms[1].rotation.x = -0.6 * w; }
          if (a.verb === 'nod') { T.head.rotation.x += 0.28 * s(7) * w; }
          if (a.verb === 'wave') { T.arms[1].rotation.z = 2.4 * w + 0.35 * s(11) * w; }
          if (a.verb === 'laugh') { T.head.rotation.x -= 0.12 * w; T.head.position.y += 0.06 * Math.abs(s(13)) * w; T.body.scale.y += 0.05 * s(13) * w; T.mouth.scale.y = 0.35 + 0.9 * w; T.mouth.scale.x = 1.1 + 0.4 * w; T.eyes.forEach(e => e.scale.y = 0.35); }
          if (a.verb === 'look') { const o = toys[a.target]; if (o) T.head.rotation.y += Math.atan2(o.g.position.x - T.g.position.x, 3) * w * 1.2; }
        });
        camAt(t);
        R.render(scene, cam);
      };
    },

    // ---------------- 2D mascot stage ----------------
    stage(el, host) {
      const root = host.parentElement;
      const bgEl = h('div', 'el worldsky', root);
      const [b1, b2] = (el.named.bg || '#bfe6ff,#f4fbff').split(',');
      bgEl.style.background = `linear-gradient(180deg, ${b1}, ${b2 || '#fff'})`;
      const svg = s('svg', { viewBox: `0 0 ${M.w} ${M.h}`, width: M.w, height: M.h, class: 'el worldcv' }, root);
      const defs = s('defs', {}, svg);
      const cam = s('g', {}, svg);
      const mk = (tag, a, parent) => s(tag, a, parent);
      // ---- layered meadow: clouds drift, hills parallax with the camera ----
      const cloudsG = mk('g', {}, cam), hillsFar = mk('g', {}, cam), hillsNear = mk('g', {}, cam), floor = mk('g', {}, cam), chars = mk('g', {}, cam);
      const clouds = [[0.12, 0.2, 1.0, 9], [0.55, 0.12, 0.75, 6], [0.82, 0.27, 0.9, 7], [0.35, 0.36, 0.55, 5]].map(([x, y, k, v]) => {
        const g = mk('g', {}, cloudsG);
        [[0, 0, 46], [44, -12, 58], [96, 0, 46], [48, 14, 70]].forEach(([dx, dy, r]) => mk('circle', { cx: dx * k, cy: dy * k, r: r * k * 0.7, fill: '#fff', opacity: 0.92 }, g));
        return { g, x, y, v };
      });
      mk('path', { d: `M0 ${M.h * 0.66} Q ${M.w * 0.22} ${M.h * 0.5} ${M.w * 0.5} ${M.h * 0.62} T ${M.w} ${M.h * 0.58} V ${M.h} H0 Z`, fill: '#b9e6a0' }, hillsFar);
      mk('path', { d: `M0 ${M.h * 0.78} Q ${M.w * 0.3} ${M.h * 0.66} ${M.w * 0.62} ${M.h * 0.76} T ${M.w} ${M.h * 0.72} V ${M.h} H0 Z`, fill: el.named.ground || '#9fd878' }, hillsNear);
      mk('ellipse', { cx: M.w / 2, cy: M.h * 0.93, rx: M.w * 0.7, ry: M.h * 0.1, fill: '#8ccb68' }, floor);
      const kids = el.children || [];
      // ---- expressions as data: every mood is a parameter set; moods blend smoothly ----
      const MOOD = {
        neutral:   { brow: 0,     browY: 0,   lid: 1,    pupil: 1,    open: 0,    blush: 0.15, wing: 0,    droop: 0,   squint: 0 },
        happy:     { brow: -0.18, browY: -4,  lid: 0.86, pupil: 1.05, open: 0.45, blush: 0.75, wing: -0.25, droop: 0,   squint: 0.3 },
        sad:       { brow: 0.5,   browY: 6,   lid: 0.8,  pupil: 1.15, open: 0,    blush: 0,    wing: 0.55,  droop: 0.9, squint: 0 },
        surprised: { brow: -0.1,  browY: -16, lid: 1.15, pupil: 0.65, open: 0.9,  blush: 0.1,  wing: -0.9,  droop: 0,   squint: 0 },
        angry:     { brow: -0.55, browY: 4,   lid: 0.8,  pupil: 0.95, open: 0.15, blush: 0,    wing: -0.15, droop: 0,   squint: 0.1 },
        sleepy:    { brow: 0.12,  browY: 2,   lid: 0.32, pupil: 1,    open: 0,    blush: 0.1,  wing: 0.3,   droop: 0.5, squint: 0 },
        love:      { brow: -0.1,  browY: -6,  lid: 0.95, pupil: 1.25, open: 0.3,  blush: 1,    wing: -0.4,  droop: 0,   squint: 0.1 },
      };
      const mood = (a, b, k) => { const o = {}; for (const key in a) o[key] = a[key] + (b[key] - a[key]) * k; return o; };
      const mascots = {};
      kids.filter(c => c.type === 'mascot').forEach((c, i) => {
        const n = c.named, col = n.color || '#58cc02', sz = parseFloat(n.size || 1), U = sz;
        const belly = n.belly || `color-mix(in srgb, ${col} 32%, #fff)`, beak = n.beak || '#ffb020', dark = `color-mix(in srgb, ${col} 72%, #000)`, light = `color-mix(in srgb, ${col} 82%, #fff)`;
        const px = parseFloat(n.x !== undefined ? n.x : 0.5) * M.w, py = parseFloat(n.y !== undefined ? n.y : 0.9) * M.h;
        const gid = 'mg' + i + '_' + Math.round(Math.random() * 1e6);
        const grad = mk('radialGradient', { id: gid, cx: '0.38', cy: '0.28', r: '0.85' }, defs);
        mk('stop', { offset: 0, 'stop-color': light }, grad); mk('stop', { offset: 0.55, 'stop-color': col }, grad); mk('stop', { offset: 1, 'stop-color': dark }, grad);
        const g0 = mk('g', {}, chars), body = mk('g', {}, g0);
        mk('ellipse', { cx: 0, cy: 6, rx: 150 * U, ry: 20 * U, fill: '#1c3a12', opacity: 0.16 }, g0);
        const wingPath = (sx) => `M 0 ${-6 * U} C ${sx * 46 * U} ${14 * U}, ${sx * 52 * U} ${96 * U}, ${sx * 10 * U} ${142 * U} C ${-sx * 22 * U} ${104 * U}, ${-sx * 30 * U} ${28 * U}, 0 ${-6 * U} Z`;
        const wing = (sx) => { const pv = mk('g', {}, body); mk('path', { d: wingPath(sx), fill: dark }, pv); mk('path', { d: wingPath(sx), fill: 'none', stroke: `color-mix(in srgb, ${col} 50%, #000)`, 'stroke-width': 3 * U, opacity: 0.35 }, pv); return pv; };
        const wL = wing(-1), wR = wing(1);
        [-1, 1].forEach(sx => { mk('ellipse', { cx: sx * 58 * U, cy: -9 * U, rx: 46 * U, ry: 18 * U, fill: beak }, body); [-1, 0, 1].forEach(k => mk('rect', { x: (sx * 58 + k * 15 - 3) * U, y: -20 * U, width: 6 * U, height: 14 * U, rx: 3 * U, fill: '#e8890a', opacity: 0.5 }, body)); });
        mk('ellipse', { cx: 0, cy: -150 * U, rx: 138 * U, ry: 152 * U, fill: `url(#${gid})` }, body);
        const tufts = [-1, 1].map(sx => { const t = mk('g', { transform: `translate(${sx * 74 * U},${-296 * U})` }, body); mk('ellipse', { cx: 0, cy: -10 * U, rx: 24 * U, ry: 42 * U, fill: col }, t); mk('ellipse', { cx: 0, cy: -4 * U, rx: 12 * U, ry: 28 * U, fill: light, opacity: 0.45 }, t); return t; });
        mk('ellipse', { cx: 0, cy: -84 * U, rx: 94 * U, ry: 86 * U, fill: belly }, body);
        for (let r = 0; r < 2; r++) for (let k = -2; k <= 2; k++) mk('path', { d: `M ${(k * 30 - 14) * U} ${(-70 + r * 34) * U} q ${14 * U} ${14 * U} ${28 * U} 0`, fill: 'none', stroke: `color-mix(in srgb, ${col} 25%, #fff)`, 'stroke-width': 4 * U, 'stroke-linecap': 'round', opacity: 0.8 }, body);
        const cheeks = [-1, 1].map(sx => mk('ellipse', { cx: sx * 104 * U, cy: -150 * U, rx: 22 * U, ry: 14 * U, fill: '#ff7d8a', opacity: 0 }, body));
        const eyes = [-1, 1].map(sx => {
          const g = mk('g', { transform: `translate(${sx * 66 * U},${-205 * U})` }, body), lid = mk('g', {}, g);
          mk('circle', { r: 61 * U, fill: '#fff' }, lid); mk('circle', { r: 61 * U, fill: 'none', stroke: `color-mix(in srgb, ${col} 60%, #000)`, 'stroke-width': 3 * U, opacity: 0.25 }, lid);
          const pup = mk('g', {}, lid); mk('circle', { r: 28 * U, fill: '#1b2733' }, pup); mk('circle', { cx: 9 * U, cy: -10 * U, r: 10 * U, fill: '#fff' }, pup); mk('circle', { cx: -9 * U, cy: 10 * U, r: 5 * U, fill: '#fff', opacity: 0.8 }, pup);
          return { g, lid, pup };
        });
        const brow = [-1, 1].map(() => mk('rect', { x: -28 * U, y: -6 * U, width: 56 * U, height: 13 * U, rx: 6.5 * U, fill: dark }, body));
        const beakG = mk('g', {}, body);
        mk('path', { d: `M ${-30 * U} ${-170 * U} Q 0 ${-212 * U} ${30 * U} ${-170 * U} Q 0 ${-122 * U} ${-30 * U} ${-170 * U} Z`, fill: beak }, beakG);
        const jaw = mk('path', { d: `M ${-24 * U} ${-150 * U} Q 0 ${-116 * U} ${24 * U} ${-150 * U} Q 0 ${-96 * U} ${-24 * U} ${-150 * U} Z`, fill: '#d9770a', opacity: 0 }, beakG);
        mascots[c.text[0]] = { name: c.text[0], g0, body, wL, wR, tufts, cheeks, eyes, brow, beakG, jaw, px, py, U, seed: i * 1.9 + 0.3, base: MOOD[n.mood || 'neutral'] };
      });
      const confetti = Array.from({ length: 28 }, (_, i) => ({ x: ((i * 37) % 100) / 100 - 0.5, v: 260 + (i * 53) % 220, w: ((i * 29) % 100) / 100 - 0.5, c: ['#58cc02', '#ffc800', '#1cb0f6', '#ff4b4b', '#ce82ff'][i % 5], rot: i * 40 }));
      const conf = confetti.map(c => mk('rect', { width: 14, height: 8, rx: 2, fill: c.c, opacity: 0 }, svg));
      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, to: c.named.to }));
      const feels = (who) => acts.filter(a => a.who === who && a.verb === 'feel').sort((a, b) => a.at - b.at);
      const cams = kids.filter(c => c.type === 'camera').sort((a, b) => a.at - b.at);
      const ease = x => 1 - Math.pow(1 - clamp(x), 3);
      const dirs = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], forward: [0, 0] };
      return (p, lt) => {
        const t = Math.max(lt, 0);
        let push = 1, pan = 0; cams.forEach(c => { const k = ease((t - c.at) / c.dur); if (c.named.push !== undefined) push += (parseFloat(c.named.push) - 1) * k; if (c.named.pan !== undefined) pan += parseFloat(c.named.pan) * k; });
        cam.setAttribute('transform', `translate(${M.w / 2},${M.h * 0.66}) scale(${push}) translate(${-M.w / 2 - pan * 40},${-M.h * 0.66})`);
        clouds.forEach(c => { const x = ((c.x * M.w + t * c.v) % (M.w + 360)) - 180; c.g.setAttribute('transform', `translate(${x},${c.y * M.h})`); });
        hillsFar.setAttribute('transform', `translate(${pan * 16},0)`); hillsNear.setAttribute('transform', `translate(${pan * 28},0)`);
        let confK = -1, confX = 0, confY = 0;
        Object.values(mascots).forEach(m => {
          const U = m.U, ph = t * 2.2 + m.seed;
          // current expression: start from the mascot's base mood and blend through every `feel` that has begun
          let cur = m.base;
          feels(m.name).forEach(f => { if (t >= f.at) cur = mood(cur, MOOD[f.to || 'neutral'], ease((t - f.at) / Math.max(f.dur, 0.05))); });
          let jy = 0, sx = 1, sy = 1 + 0.012 * Math.sin(ph) - 0.05 * cur.droop, rot = 0, wl = 0.12, wr = -0.12, open = cur.open, px = 4 * Math.sin(t * 0.7 + m.seed), py = 3 * Math.sin(t * 0.5) + 8 * cur.droop;
          wl = 0.12 + cur.wing * 0.9; wr = -0.12 - cur.wing * 0.9;
          let squint = cur.squint, brow = cur.brow, browY = cur.browY;
          acts.forEach(a => {
            if (a.who !== m.name || a.verb === 'feel') return;
            const k = (t - a.at) / a.dur; if (k < 0 || k > 1) return; const w = Math.sin(Math.PI * k);
            if (a.verb === 'wave') wr = -2.4 * w + 0.35 * Math.sin(t * 12) * w;
            if (a.verb === 'talk') { open = Math.max(open, Math.abs(Math.sin(t * 11)) * w); rot = 0.03 * Math.sin(t * 2.4) * w; wr = -0.5 * w; }
            if (a.verb === 'nod') py += 10 * Math.sin(t * 8) * w;
            if (a.verb === 'look') { const d = dirs[a.to] || [0, 0]; px = d[0] * 17 * w; py = d[1] * 15 * w; }
            if (a.verb === 'hop') { jy = -90 * U * Math.sin(Math.PI * k); sy = 1 + 0.12 * Math.sin(Math.PI * k); sx = 1 / sy; }
            if (a.verb === 'cheer') { const hop = Math.abs(Math.sin(Math.PI * k * 2.2)); jy = -120 * U * hop; sy = 1 + 0.14 * hop - (hop < 0.12 ? 0.18 : 0); sx = 1 / sy; wl = -2.5 * w; wr = 2.5 * w; open = 0.85 * w; squint = Math.max(squint, w); brow = -0.3 * w; confK = k; confX = m.px; confY = m.py - 300 * U; }
            if (a.verb === 'laugh') { jy = -14 * U * Math.abs(Math.sin(t * 13)) * w; squint = Math.max(squint, w); open = Math.max(open, 0.8 * w); }
            if (a.verb === 'sad') { sy = 1 - 0.07 * w; wl = 0.12 + 0.5 * w; wr = -0.12 - 0.5 * w; brow = 0.4 * w; py += 12 * w; }
          });
          m.g0.setAttribute('transform', `translate(${m.px},${m.py + jy})`);
          m.body.setAttribute('transform', `rotate(${rot * 57.3}) scale(${sx},${sy})`);
          m.wL.setAttribute('transform', `translate(${-128 * U},${-150 * U}) rotate(${wl * 57.3})`); m.wR.setAttribute('transform', `translate(${128 * U},${-150 * U}) rotate(${wr * 57.3})`);
          m.tufts.forEach((tf, i2) => tf.setAttribute('transform', `translate(${(i2 ? 1 : -1) * 74 * U},${(-296 + 6 * cur.droop) * U}) rotate(${(i2 ? 1 : -1) * (22 + 4 * Math.sin(t * 3 + i2) + 22 * cur.droop)})`));
          const blink = ((t + m.seed) % 3.1) < 0.12 ? 0.08 : 1;
          m.eyes.forEach(e => { e.lid.setAttribute('transform', `scale(1,${Math.max(0.08, blink * cur.lid * (1 - 0.55 * squint))})`); e.pup.setAttribute('transform', `translate(${px * U},${py * U}) scale(${cur.pupil})`); });
          m.brow.forEach((b, i2) => { const sg = i2 ? 1 : -1; b.setAttribute('transform', `translate(${sg * 66 * U},${(-282 + browY - 6 * squint) * U}) rotate(${(brow * -sg) * 57.3})`); });
          m.cheeks.forEach(c => c.setAttribute('opacity', 0.55 * cur.blush));
          m.beakG.setAttribute('transform', `translate(0,${-4 * cur.droop * U})`);
          m.jaw.setAttribute('opacity', open > 0.05 ? 1 : 0); m.jaw.setAttribute('transform', `translate(0,${open * 16 * U})`);
        });
        conf.forEach((r, i) => {
          if (confK < 0) { r.setAttribute('opacity', 0); return; }
          const c = confetti[i], tt = confK * 2.6;
          r.setAttribute('x', confX + c.x * 520 + c.w * 90 * tt); r.setAttribute('y', confY - c.v * tt * 0.75 + 520 * tt * tt * 0.55);
          r.setAttribute('transform', `rotate(${c.rot + tt * 360 * (c.w + 0.6)} ${confX + c.x * 520} ${confY})`); r.setAttribute('opacity', clamp(1.4 - confK));
        });
      };
    },

    // ---------------- architecture diagram (nodes, edges, zones, spotlight shots, captions) ----------------
    diagram(el, host) {
      const root = host.parentElement, W = M.w, H = M.h;
      const cols = Math.max(...(el.children || []).filter(c => c.type === 'node').map(c => c.depth || 0)) + 1;
      const CW = clamp(Math.floor(W * 0.82 / cols * 0.62), 84, 132), CH = CW, U = CW / 132;   // cards shrink as columns grow, so edges keep room
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'el worldcv' }, root);
      const cam = s('g', {}, svg);
      const zoneG = s('g', {}, cam), edgeG = s('g', {}, cam), nodeG = s('g', {}, cam), pktG = s('g', {}, cam), labG = s('g', {}, cam);   // labels sit above the cards
      const kids = el.children || [];
      const auto = el.named.steps === 'on';
      const nodes = {}; let k = 0;
      kids.filter(c => c.type === 'node').forEach(c => {
        const id = c.args[0], x = c.px * W, y = c.py * H;
        const g = s('g', {}, nodeG);
        s('rect', { x: x - CW / 2 + 4, y: y - CH / 2 + 7, width: CW, height: CH, rx: 24, fill: '#000', opacity: 0.12 }, g);
        s('rect', { x: x - CW / 2, y: y - CH / 2, width: CW, height: CH, rx: 24, style: 'fill:color-mix(in srgb, var(--fg) 6%, var(--bg1)); stroke:color-mix(in srgb, var(--fg) 20%, transparent)', 'stroke-width': 2 }, g);
        if (c.named.icon) { const im = s('image', { x: x - 42 * U, y: y - CH / 2 + 12 * U, width: 84 * U, height: 84 * U }, g); im.setAttribute('href', imgSrc(c.named.icon)); }
        else { s('circle', { cx: x, cy: y - 16, r: 36, style: 'fill:var(--c3)' }, g); const t0 = s('text', { x, y: y - 4, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, fill: '#fff' }, g); t0.textContent = (c.text[0] || '?')[0]; }
        const words = c.text[0].split(' '); const half = Math.ceil(words.length / 2);
        const lines = c.text[0].length > 14 && words.length > 1 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [c.text[0]];
        lines.forEach((ln, i) => { const t = s('text', { x, y: y + CH / 2 - 20 * U + i * 17 * U - (lines.length - 1) * 8 * U, 'text-anchor': 'middle', 'font-size': Math.max(13, 17 * U), 'font-weight': 600, style: 'fill:var(--fg)' }, g); t.textContent = ln; });
        const stepN = c.named.step || (auto ? ++k : null);
        let badge = null;
        if (stepN) { badge = s('g', {}, g); s('circle', { cx: x - CW / 2 + 6, cy: y - CH / 2 + 6, r: 17, style: 'fill:var(--c3)' }, badge); const bt = s('text', { x: x - CW / 2 + 6, y: y - CH / 2 + 13, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: '#fff' }, badge); bt.textContent = stepN; }
        nodes[id] = { id, g, x, y, appear: c.appear, badge };
      });
      // ---- edges: orthogonal routes with rounded corners, ports spread per side, real arrowheads, label pills ----
      const portCount = {}, portIdx = {};
      const edgeDefs = kids.filter(c => c.type === 'edge').map(c => {
        const a = nodes[c.args[0]], b = nodes[c.args[2]], horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) * 0.6;
        const sideA = horiz ? (b.x >= a.x ? 'R' : 'L') : (b.y >= a.y ? 'B' : 'T'), sideB = horiz ? (b.x >= a.x ? 'L' : 'R') : (b.y >= a.y ? 'T' : 'B');
        const ka = a.id + sideA, kb = b.id + sideB; portCount[ka] = (portCount[ka] || 0) + 1; portCount[kb] = (portCount[kb] || 0) + 1;
        return { c, a, b, horiz, sideA, sideB, ka, kb };
      });
      const spread = (key) => { const n = portCount[key], i = (portIdx[key] = (portIdx[key] || 0) + 1) - 1; return n === 1 ? 0 : (i - (n - 1) / 2) * Math.min(26, CW / (n + 0.5)); };
      const rr = 16;
      const edges = edgeDefs.map(({ c, a, b, horiz, sideA, sideB, ka, kb }) => {
        const oa = spread(ka), ob = spread(kb);
        let pts;
        if (horiz) { const dir = b.x >= a.x ? 1 : -1, x1 = a.x + dir * CW / 2, y1 = a.y + oa, x2 = b.x - dir * CW / 2, y2 = b.y + ob, xm = (x1 + x2) / 2; pts = Math.abs(y1 - y2) < 2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [xm, y1], [xm, y2], [x2, y2]]; }
        else { const dir = b.y >= a.y ? 1 : -1, x1 = a.x + oa, y1 = a.y + dir * CH / 2, x2 = b.x + ob, y2 = b.y - dir * CH / 2, ym = (y1 + y2) / 2; pts = Math.abs(x1 - x2) < 2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [x1, ym], [x2, ym], [x2, y2]]; }
        let d = `M${pts[0][0]},${pts[0][1]}`;
        for (let i = 1; i < pts.length - 1; i++) {
          const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
          const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy), r = Math.min(rr, l1 / 2, l2 / 2);
          d += ` L${cx - (cx - px) / l1 * r},${cy - (cy - py) / l1 * r} Q${cx},${cy} ${cx + (nx - cx) / l2 * r},${cy + (ny - cy) / l2 * r}`;
        }
        const [ex, ey] = pts[pts.length - 1], [sx, sy] = pts[pts.length - 2];
        d += ` L${ex},${ey}`;
        const col = c.named.color || 'var(--c3)', dashed = c.named.style === 'dashed';
        const track = s('path', { d, fill: 'none', style: `stroke:${col}`, 'stroke-width': 9, 'stroke-opacity': 0.12, 'stroke-linecap': 'round' }, edgeG);
        const path = s('path', { d, fill: 'none', style: `stroke:${col}`, 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, edgeG);
        const ang = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI;
        const head = s('path', { d: 'M2,0 L-18,-11 Q-13,0 -18,11 Z', style: `fill:${col}`, transform: `translate(${ex},${ey}) rotate(${ang})`, opacity: 0 }, edgeG);
        let lab = null;
        if (c.named.label) {
          const mid0 = pts.length === 4 ? [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
          const segLen = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : 999;
          const mid = segLen < c.named.label.length * 8.6 + 40 ? [mid0[0], mid0[1] - CH / 2 - 18] : mid0;   // short edge: float the label above the cards   // short edge: lift the label above the line so cards never cover it
          lab = s('g', {}, labG); const w = c.named.label.length * 8.6 + 22;
          s('rect', { x: mid[0] - w / 2, y: mid[1] - 14, width: w, height: 28, rx: 14, style: 'fill:var(--bg1); stroke:color-mix(in srgb, var(--fg) 25%, transparent)', 'stroke-width': 1.5 }, lab);
          const tx = s('text', { x: mid[0], y: mid[1] + 5.5, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, style: 'fill:var(--fg)' }, lab); tx.textContent = c.named.label; lab.setAttribute('opacity', 0);
        }
        const len = path.getTotalLength();
        if (!dashed) path.style.strokeDasharray = len; else path.setAttribute('stroke-dasharray', '10 9');
        const pk = [0, 0.5].map(() => s('circle', { r: 6, style: 'fill:#fff', stroke: col, 'stroke-width': 2.5, opacity: 0 }, pktG));
        return { a: c.args[0], b: c.args[2], path, track, head, lab, len, dashed, appear: c.appear, pk };
      });
      const zones = kids.filter(c => c.type === 'zone').map(c => {
        const ids = (c.named.ids || '').split(',').filter(i => nodes[i]);
        const xs = ids.map(i => nodes[i].x), ys = ids.map(i => nodes[i].y);
        const pad = 46, x0 = Math.min(...xs) - CW / 2 - pad, y0 = Math.min(...ys) - CH / 2 - pad - 18, x1 = Math.max(...xs) + CW / 2 + pad, y1 = Math.max(...ys) + CH / 2 + pad;
        const g = s('g', {}, zoneG);
        s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 30, style: 'fill:color-mix(in srgb, var(--c3) 7%, transparent); stroke:color-mix(in srgb, var(--c3) 55%, transparent)', 'stroke-width': 2.5, 'stroke-dasharray': '12 9' }, g);
        const t = s('text', { x: x0 + 22, y: y0 + 30, 'font-size': 20, 'font-weight': 800, 'letter-spacing': '.08em', style: 'fill:var(--c3)' }, g); t.textContent = (c.text[0] || '').toUpperCase();
        return { g, appear: Math.min(...ids.map(i => nodes[i].appear)) - 0.2 };
      });
      const shots = kids.filter(c => c.type === 'shot').sort((p, q) => p.at - q.at).map(c => ({ at: c.at, dur: c.dur || 1.2, ids: (c.named.ids || 'all').split(','), dim: c.named.dim !== undefined ? parseFloat(c.named.dim) : 0.18 }));
      const caps = kids.filter(c => c.type === 'caption').map(c => ({ text: c.text[0], sub: c.named.sub, at: c.at, dur: c.dur || 3 }));
      const capEl = h('div', 'dcap', root);
      const ease = x => 1 - Math.pow(1 - clamp(x), 3);
      const view = shot => {
        if (!shot || shot.ids[0] === 'all') return { k: 1, cx: W / 2, cy: H / 2, set: null };
        const list = shot.ids.map(i => nodes[i]).filter(Boolean);
        const x0 = Math.min(...list.map(n => n.x)) - CW, x1 = Math.max(...list.map(n => n.x)) + CW, y0 = Math.min(...list.map(n => n.y)) - CH, y1 = Math.max(...list.map(n => n.y)) + CH;
        return { k: clamp(Math.min(W * 0.8 / (x1 - x0), H * 0.74 / (y1 - y0)), 1, 2.4), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, set: new Set(shot.ids) };
      };
      return (p, lt) => {
        const t = Math.max(lt, 0);
        // spotlight camera: blend from the previous shot's view to the current one, dimming everything outside the focus
        let idx = -1; shots.forEach((sh, i) => { if (t >= sh.at) idx = i; });
        const cur = view(shots[idx]), prev = view(shots[idx - 1]), kk = idx >= 0 ? ease((t - shots[idx].at) / shots[idx].dur) : 1;
        const k = prev.k + (cur.k - prev.k) * kk, cx = prev.cx + (cur.cx - prev.cx) * kk, cy = prev.cy + (cur.cy - prev.cy) * kk;
        cam.setAttribute('transform', `translate(${W / 2},${H / 2}) scale(${k}) translate(${-cx},${-cy})`);
        const dimK = idx >= 0 && shots[idx].ids[0] !== 'all' ? kk : (idx >= 1 && shots[idx - 1].ids[0] !== 'all' ? 1 - kk : 0);
        const focus = idx >= 0 && shots[idx].ids[0] !== 'all' ? cur.set : (idx >= 1 ? prev.set : null);
        const dimTo = idx >= 0 ? shots[idx].dim : 1;
        const op = id => (focus && !focus.has(id) ? 1 + (dimTo - 1) * dimK : 1);
        Object.values(nodes).forEach(n => {
          const q = ease((t - n.appear) / 0.5), back = 1 + 1.4 * Math.pow(q - 1, 3) + 0.4 * Math.pow(q - 1, 2);
          n.g.setAttribute('opacity', clamp(q * 2) * op(n.id));
          n.g.setAttribute('transform', `translate(${n.x},${n.y}) scale(${0.6 + 0.4 * Math.min(back, 1.08)}) translate(${-n.x},${-n.y})`);
        });
        zones.forEach(z => z.g.setAttribute('opacity', clamp((t - z.appear) / 0.6)));
        edges.forEach(e => {
          const q = ease((t - e.appear) / 0.7), o = Math.min(op(e.a), op(e.b));
          e.track.setAttribute('opacity', q * o);
          if (e.dashed) e.path.setAttribute('opacity', q * o); else { e.path.style.strokeDashoffset = e.len * (1 - q); e.path.setAttribute('opacity', o); }
          e.head.setAttribute('opacity', clamp((q - 0.9) * 10) * o);
          if (e.lab) e.lab.setAttribute('opacity', clamp((q - 0.6) * 2.5) * o);
          e.pk.forEach((c, i) => {
            if (q < 1) { c.setAttribute('opacity', 0); return; }
            const f = (t * 0.22 + i * 0.5) % 1, pt = e.path.getPointAtLength(f * e.len);
            c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('opacity', Math.sin(Math.PI * f) * o);
          });
        });
        const cap = caps.find(c => t >= c.at && t <= c.at + c.dur);
        if (cap) { const f = Math.min(1, (t - cap.at) / 0.35, (cap.at + cap.dur - t) / 0.35); capEl.innerHTML = `<b>${esc(cap.text)}</b>` + (cap.sub ? `<span>${esc(cap.sub)}</span>` : ''); capEl.style.opacity = clamp(f); capEl.style.transform = `translateX(-50%) translateY(${(1 - clamp(f)) * 14}px)`; }
        else capEl.style.opacity = 0;
      };
    },
    shape(el, host) {
      const size = parseFloat(el.named.size) || 140;
      const kind = el.args[0] || 'circle';
      const e = h('div', 'el', host);
      e.style.cssText = `width:${size}px;height:${size}px;background:${el.named.color || 'linear-gradient(135deg,var(--c1),var(--c3))'};` +
        `border-radius:${kind === 'rect' ? '24px' : '50%'}`;
      if (kind === 'ring') e.style.cssText += ';background:none;border:12px solid var(--c2)';
      return null;
    },
  };

  function textEl(cls, el, host) {
    const node = h('div', 'el ' + cls, host);
    node.textContent = el.text[0];
    return { node, text: el.text[0] };
  }

  const scenes = M.scenes.map(sc => {
    const node = h('div', 'scene', stage);
    const stack = h('div', 'stack ' + sc.layout, node);
    if (M.corner && sc.layout === 'slide' && !sc.els.some(e => e.type === 'cover' || e.type === 'divider')) h('img', 'corner', node).src = imgSrc(M.corner);
    const items = [];
    const add = (el, host) => {
      const made = builders[el.type](el, host, add);
      let node_, setP = null, text = null;
      if (made && made.node) { node_ = made.node; text = made.text === undefined ? null : made.text; }
      else if (typeof made === 'function') { setP = made; node_ = host.lastElementChild; }
      else node_ = host.lastElementChild;
      if (el.named.mt && node_) node_.style.marginTop = el.named.mt + 'px';
      items.push({ el, node: node_, setP, text });
    };
    sc.els.forEach(el => add(el, stack));
    return { sc, node, stack, items };
  });

  // Layout guard: LLMs cannot judge pixel sizes, so the runtime measures every scene
  // and scales it to fit the artboard. The report tells the author what was adjusted.
  window.__PRISM_LAYOUT__ = scenes.map(({ node, stack }, i) => {
    node.style.display = 'flex'; node.style.visibility = 'hidden';
    const slide = M.scenes[i].layout === 'slide';        // full-bleed slides use the whole artboard, no extra padding
    const needH = slide ? stack.scrollHeight : stack.offsetHeight, needW = slide ? stack.scrollWidth : stack.offsetWidth;
    const k = Math.min(1, (slide ? M.h : M.h - 120) / needH, (slide ? M.w : M.w - 180) / needW);
    if (k < 1) stack.style.transform = `scale(${k})`;
    node.style.display = 'none'; node.style.visibility = '';
    return { scene: i + 1, contentPx: [needW, needH], scale: +k.toFixed(3), fitted: k < 1 };
  });
  window.__PRISM_LAYOUT__.filter(l => l.fitted).forEach(l =>
    console.warn(`prism: scene ${l.scene} content ${l.contentPx.join('x')}px exceeded the artboard; scaled to ${Math.round(l.scale * 100)}%`));

  const pad2 = n => String(n).padStart(2, '0');
  const showNums = M.numbers && new URLSearchParams(location.search).get('nonum') !== '1';
  const badge = showNums ? h('div', 'slidenum', stage) : null, bar = showNums ? h('div', 'progress', stage) : null;
  function render(t) {
    if (badge) {
      const i = Math.max(0, M.scenes.findIndex(sc => t >= sc.start && t < sc.end));
      badge.innerHTML = `<b>${pad2(i + 1)}</b> / ${pad2(M.scenes.length)}`;
      bar.style.width = (100 * t / M.dur) + '%';
    }
    drawBackground(t);
    scenes.forEach(({ sc, node, items }, index) => {
      const on = t >= sc.start && t < sc.end;
      node.style.display = on ? 'flex' : 'none';
      if (!on) return;
      // Scenes fade into the next one. The last scene holds: a finished piece keeps its last card on screen.
      const o = index === scenes.length - 1 && !loopMode ? 1 : clamp((sc.end - t) / 0.45); node.style.opacity = o;  node.style.transform = o < 1 ? `scale(${1 + (1 - o) * 0.035})` : '';
      items.forEach(({ el, node: n, setP, text }) => {
        const lt = t - sc.start - el.at;
        const ease = easeBy(el.ease || (el.in === 'pop' ? 'back' : 'out'));
        const raw = clamp(lt / el.dur);
        const p = ease(raw);
        if (setP) setP(el.type === 'bars' ? raw : p, lt);
        if (text !== null) {
          if (el.in === 'type') { n.textContent = text.slice(0, Math.round(raw * text.length)); n.style.opacity = raw > 0 ? 1 : 0; }
          else applyIn(n, el.in, p);
        } else if (['bars', 'line', 'donut', 'shape', 'orb'].includes(el.type)) {
          if (el.type === 'shape' || el.type === 'orb') applyIn(n, el.in, p);
          else if (el.in !== 'none') n.style.opacity = clamp(raw * 6);
        } else if (!setP || el.type === 'steps' || el.type === 'bullets' || el.type === 'hub') {
          applyIn(n, el.in, p);                       // slide-kit elements
        }
      });
    });
  }

  // Player: one clock, fully scrubbable, deterministic for frame-by-frame capture.
  const play = document.getElementById('play'), scrub = document.getElementById('scrub'), clock = document.getElementById('clock');
  let t = 0, playing = true, last = null;
  function fit() {
    const wrap = document.getElementById('wrap');
    const k = Math.min(wrap.clientWidth / M.w, wrap.clientHeight / M.h);
    stage.style.transform = `scale(${k})`;
  }
  function seek(x) {
    t = clamp(x, 0, M.dur - 0.001);
    render(t);
    scrub.value = (t / M.dur) * 1000;
    clock.textContent = `${t.toFixed(1)} / ${M.dur.toFixed(1)}s`;
  }
  const q = new URLSearchParams(location.search);
  const presentMode = !!M.present || q.get('present') === '1';
  const loopMode = !!M.loop || q.get('loop') === '1';
  // Presentation mode: each slide has a settled moment (its "stop"). Click or a key plays the next build at full speed;
  // pressing again mid-build finishes it; going back is an instant seek because every frame is a function of t.
  const stops = scenes.map(({ sc, items }) => Math.min(sc.start + Math.max(0.6, ...items.map(i => i.el.at + i.el.dur)) + 0.2, sc.end - 0.5));
  let cur = 0, target = presentMode ? stops[0] : null;
  function tick(now) {
    if (playing) {
      if (last !== null) {
        t += Math.min((now - last) / 1000, 0.1);   // lag smoothing: a stalled frame never makes the timeline jump
        if (presentMode) { if (t >= target) { t = target; playing = false; } }
        else if (t >= M.dur) { if (loopMode) t = 0; else { t = M.dur - 0.001; playing = false; } }   // a finished piece holds its last card, like every other format
        seek(t);
      }
      last = now;
    } else last = null;
    requestAnimationFrame(tick);
  }
  function settle() { t = target; playing = false; seek(t); }
  function next() {
    if (playing) return settle();                                  // finish the running build first
    if (cur >= scenes.length - 1) return;
    t = Math.max(t, M.scenes[cur].end - 0.45);                      // skip the idle hold, play exit + next entrance
    cur++; target = stops[cur]; playing = true; last = null;
  }
  function goto(i) { cur = clamp(i, 0, scenes.length - 1); target = stops[cur]; playing = false; seek(target); }
  function prev() { if (playing) return settle(); goto(cur - 1); }
  play.onclick = () => { if (presentMode) return next(); playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; };
  scrub.oninput = () => { playing = false; play.textContent = 'Play'; seek((scrub.value / 1000) * M.dur); };
  addEventListener('keydown', e => {
    if (!presentMode) { if (e.code === 'Space') { e.preventDefault(); play.onclick(); } return; }
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'Space', 'Enter'].includes(e.code)) next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.code)) prev();
    else if (e.code === 'Home') goto(0);
    else if (e.code === 'End') goto(scenes.length - 1);
    else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    else return;
    e.preventDefault();
  });
  if (presentMode) {
    document.body.classList.add('present');
    document.addEventListener('click', e => { if (e.button === 0) next(); });
    document.addEventListener('contextmenu', e => { e.preventDefault(); prev(); });
    let x0 = null;
    addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (dx < -40) next(); else if (dx > 40) prev(); });
    const hint = h('div', 'hint', document.body); hint.textContent = 'click or \u2192 next   \u2190 back   F fullscreen';
    setTimeout(() => { hint.style.opacity = 0; }, 3500);
  }
  addEventListener('resize', fit);
  window.seek = seek;
  window.__PRISM_STOPS__ = stops; window.__PRISM_PRESENT__ = () => ({ cur, playing, t: +t.toFixed(2) });
  window.pause = () => { playing = false; play.textContent = 'Play'; };
  window.__PRISM_DURATION__ = M.dur;
  if (q.get('controls') === '0') document.body.classList.add('nocontrols');
  fit();
  if (q.has('t')) { playing = false; seek(parseFloat(q.get('t'))); play.textContent = 'Play'; }
  else seek(0);
  if (presentMode) { playing = true; last = null; }
  requestAnimationFrame(tick);
})();
