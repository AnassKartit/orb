// Orb language layer, shared by every target: variables, expressions, data tables, def (components with named
// parameters, defaults and slots), repeat, if, and modules (import). expand(source) returns plain item text plus
// a map from each output line back to its source line, so later errors still point at what the author wrote.
// No eval anywhere. `dialect: 'player'` keeps the older, looser tokenising that existing .prism files rely on.
const fs = require('fs');
const path = require('path');

class LangError extends Error {
  constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
}
const STD = path.join(__dirname, '..', 'std');

// ---------- expressions ----------
const TOKENS = {
  player: /\s*(\d+\.?\d*|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|==|!=|>=|<=|[-+*/%()<>,])/g,
  video: /\s*((?:\d+\.?\d*|\.\d+)|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|==|!=|>=|<=|[-+*/%()<>,])/g,
};

// Typed values: number, string, boolean, list, record. Lists and records come from literals ([1, 2, 3]),
// data tables and module namespaces. Strings inside expressions use single quotes: {n > 3 ? 'big' : 'small'}.
const list = (args) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
const numbers = (args, name, bad) => list(args).map(v => { const n = typeof v === 'number' ? v : Number(v); if (!Number.isFinite(n)) bad(`${name} needs numbers`); return n; });
const BUILTINS = {
  round: (a, bad) => a.length > 1 ? Math.round(a[0] * 10 ** a[1]) / 10 ** a[1] : Math.round(a[0]),
  floor: a => Math.floor(a[0]), ceil: a => Math.ceil(a[0]), abs: a => Math.abs(a[0]), sqrt: a => Math.sqrt(a[0]),
  pow: a => Math.pow(a[0], a[1]), sin: a => Math.sin(a[0]), cos: a => Math.cos(a[0]),
  min: (a, bad) => Math.min(...numbers(a, 'min', bad)), max: (a, bad) => Math.max(...numbers(a, 'max', bad)),
  sum: (a, bad) => numbers(a, 'sum', bad).reduce((x, y) => x + y, 0),
  avg: (a, bad) => { const n = numbers(a, 'avg', bad); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : 0; },
  len: a => Array.isArray(a[0]) ? a[0].length : String(a[0]).length,
  argmax: (a, bad) => { const n = numbers(a, 'argmax', bad); return n.indexOf(Math.max(...n)); },
  argmin: (a, bad) => { const n = numbers(a, 'argmin', bad); return n.indexOf(Math.min(...n)); },
  range: (a, bad) => { const [from, to] = a.length > 1 ? a : [0, a[0]]; if (!(to - from >= 0 && to - from <= 500)) bad('range needs 0 to 500 steps'); return Array.from({ length: to - from }, (_, k) => from + k); },
  clamp: a => Math.min(a[2], Math.max(a[1], a[0])), lerp: a => a[0] + (a[1] - a[0]) * a[2],
  join: a => (Array.isArray(a[0]) ? a[0] : [a[0]]).map(fmt).join(a[1] === undefined ? ',' : String(a[1])),
  split: a => String(a[0]).split(a[1] === undefined ? ',' : String(a[1])).map(v => /^-?(?:\d+\.?\d*|\.\d+)$/.test(v.trim()) ? parseFloat(v) : v.trim()),
  str: a => fmt(a[0]), num: (a, bad) => { const n = Number(a[0]); if (!Number.isFinite(n)) bad(`'${a[0]}' is not a number`); return n; },
  upper: a => String(a[0]).toUpperCase(), lower: a => String(a[0]).toLowerCase(),
  commas: a => String(Math.round(a[0])).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
};
const LEGACY_FUNCS = ['round', 'floor', 'ceil', 'abs', 'min', 'max'];
const TOKEN = /\s*((?:\d+\.?\d*|\.\d+)|'(?:[^'\\]|\\.)*'|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\.[A-Za-z_]\w*|==|!=|>=|<=|&&|\|\||[-+*/%()<>,\[\]?:!])/y;

function evaluate(src, env, line, dialect = 'video') {
  let t;
  if (dialect === 'player') {
    const toks = src.match(TOKENS.player);
    if (!toks || toks.join('').replace(/\s/g, '') !== src.replace(/\s/g, '')) throw new LangError(line, `cannot read expression '${src}'`);
    t = toks.map(x => x.trim());
  } else {
    t = []; TOKEN.lastIndex = 0;
    for (let m, at = 0; at < src.length; at = TOKEN.lastIndex) {
      TOKEN.lastIndex = at;
      if (!(m = TOKEN.exec(src))) { if (!src.slice(at).trim()) break; throw new LangError(line, `cannot read expression '${src}'`); }
      t.push(m[1]);
    }
    if (!t.length) throw new LangError(line, `cannot read expression '${src}'`);
  }
  let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const bad = (m) => { throw new LangError(line, `${m} in '${src}'`); };
  const funcs = dialect === 'player' ? LEGACY_FUNCS : Object.keys(BUILTINS);

  function primary() {
    const x = next();
    if (x === undefined) bad('expression ended early');
    if (x === '(') { const v = ternary(); if (next() !== ')') bad("missing ')'"); return postfix(v); }
    if (x === '-') return -primary();
    if (x === '!') return !primary();
    if (x === '[') {
      const items = [];
      if (peek() !== ']') { do { items.push(ternary()); } while (peek() === ',' && next()); }
      if (next() !== ']') bad("missing ']'");
      return postfix(items);
    }
    if (x[0] === "'") return x.slice(1, -1).replace(/\\(.)/g, '$1');
    if (dialect === 'player' ? /^\d/.test(x) : /^(?:\d|\.\d)/.test(x)) return parseFloat(x);
    if (!/^[A-Za-z_]/.test(x)) bad(`unexpected '${x}'`);
    if (peek() === '(') {
      next();
      const args = [];
      if (peek() !== ')') { do { args.push(ternary()); } while (peek() === ',' && next()); }
      if (next() !== ')') bad("missing ')'");
      if (!funcs.includes(x)) bad(`unknown function '${x}' (available: ${funcs.join(', ')})`);
      return postfix(BUILTINS[x](args, bad));
    }
    if (x === 'true') return true;
    if (x === 'false') return false;
    let v = env;
    for (const key of x.split('.')) {
      if (!v || typeof v !== 'object' || !Object.hasOwn(v, key) || ['__proto__', 'prototype', 'constructor'].includes(key)) bad(`unknown name '${x}'`);
      v = v[key];
    }
    return postfix(typeof v === 'number' ? v : (typeof v === 'string' && Number.isFinite(parseFloat(v)) && /^-?[\d.]+$/.test(v) ? parseFloat(v) : v));
  }
  function postfix(v) {   // list[index], then .field on the result: rows[i+1].at; negative indexes count from the end
    while (dialect !== 'player' && (peek() === '[' || (peek() || '')[0] === '.')) {
      if (peek()[0] === '.') {
        const key = next().slice(1);
        if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.hasOwn(v, key)) bad(`no field '${key}' here`);
        v = v[key]; if (typeof v === 'string' && /^-?[\d.]+$/.test(v) && Number.isFinite(parseFloat(v))) v = parseFloat(v);
        continue;
      }
      next(); const k = ternary(); if (next() !== ']') bad("missing ']'");
      if (!Array.isArray(v) && typeof v !== 'string') bad('only lists and text can be indexed');
      const at = k < 0 ? v.length + k : k;
      if (!Number.isInteger(at) || at < 0 || at >= v.length) bad(`index ${k} is outside 0..${v.length - 1}`);
      v = v[at];
    }
    return v;
  }
  function term() { let v = primary(); while (['*', '/', '%'].includes(peek())) { const o = next(), r = primary(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
  function sum() { let v = term(); while (['+', '-'].includes(peek())) { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; }
  function compare() {
    let v = sum();
    while (['<', '>', '<=', '>=', '==', '!='].includes(peek())) {
      const o = next(), r = sum();
      v = o === '<' ? v < r : o === '>' ? v > r : o === '<=' ? v <= r : o === '>=' ? v >= r : o === '==' ? v === r : v !== r;
    }
    return v;
  }
  function logic() {
    let v = compare();
    while (dialect !== 'player' && (peek() === '&&' || peek() === '||')) { const o = next(), r = compare(); v = o === '&&' ? (v && r) : (v || r); }
    return v;
  }
  function ternary() {
    const v = logic();
    if (dialect === 'player' || peek() !== '?') return v;
    next(); const a = ternary(); if (next() !== ':') bad("missing ':'"); const b = ternary();
    return v ? a : b;
  }
  const out = ternary();
  if (i < t.length) bad(`unexpected '${t[i]}'`);
  return out;
}

function fmt(v) { return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : Array.isArray(v) ? v.map(fmt).join(',') : String(v); }
function interpolate(text, env, line, dialect = 'video') {
  if (dialect === 'player') return text.replace(/\{([^{}]+)\}/g, (_, e) => fmt(evaluate(e.trim(), env, line, dialect)));
  return text.replace(/(?<!\\)\{([^{}]+)(?<!\\)\}/g, (all, e, index) => {
    const value = fmt(evaluate(e.trim(), env, line, dialect));
    let quote = false, escape = false;
    for (const c of text.slice(0, index)) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') quote = !quote;
    }
    return quote ? JSON.stringify(value).slice(1, -1) : value;
  });
}

// ---------- tree ----------
function toTree(source) {
  const root = { children: [], indent: -1 };
  const stack = [root];
  source.split(/\r?\n/).forEach((raw, idx) => {
    // A comment starts at ' #'. A hex colour right after '=' (let ink = #FFE600) is a value, and a comment may follow it.
    let cut = -1;
    for (const m of raw.matchAll(/\s+#/g)) {
      const colour = /=\s*$/.test(raw.slice(0, m.index)) && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?:\s|$)/.test(raw.slice(m.index + m[0].length - 1));
      if (!colour) { cut = m.index; break; }
    }
    const body = (cut < 0 ? raw : raw.slice(0, cut)).replace(/^\s*#.*$/, '');
    if (!body.trim()) return;
    const indent = body.match(/^ */)[0].length;
    if (indent % 2) throw new LangError(idx + 1, 'indent with 2 spaces per level');
    const node = { text: body.trim(), indent, line: idx + 1, children: [] };
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root;
}

// ---------- call arguments ----------
function splitArgs(s, line, dialect) {
  if (dialect === 'player') {
    const out = [];
    const re = /([A-Za-z_][\w-]*)=("[^"]*"|\{[^{}]*\}|\S+)|"([^"]*)"|(\{[^{}]*\})|(\S+)/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) { const v = m[2]; out.push({ name: m[1], whole: m[0], ...(v[0] === '"' ? { str: v.slice(1, -1) } : { raw: v }) }); }
      else out.push(m[3] !== undefined ? { str: m[3] } : { raw: m[4] || m[5] });
    }
    return out;
  }
  const parts = []; let start = 0, quote = false, escape = false, braces = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (quote && c === '\\') { escape = true; continue; }
    if (c === '"' && quote !== "'") quote = quote ? false : '"';
    else if (c === "'" && quote !== '"' && (quote || /[\s=,\[(]/.test(s[i - 1] ?? ' '))) quote = quote ? false : "'";
    if (!quote) {
      if (c === '{' || c === '[') braces++;
      if (c === '}' || c === ']') braces--;
      if ((c === undefined || /\s/.test(c)) && !braces) { if (i > start) parts.push(s.slice(start, i)); start = i + 1; }
    }
  }
  if (quote || braces) throw new LangError(line, 'unclosed quote or expression');
  const value = raw => {
    if (/^'(?:[^'\\]|\\.)*'$/.test(raw)) return { str: raw.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (!raw.startsWith('"')) return { raw };
    try { return { str: JSON.parse(raw) }; } catch { throw new LangError(line, 'invalid quoted string'); }
  };
  return parts.map(p => {
    const m = p.match(/^([A-Za-z_][\w-]*)=(.+)$/s);
    return m ? { name: m[1], whole: p, ...value(m[2]) } : value(p);
  });
}

function closest(word, list) {
  const d = (a, b) => { const row = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] !== b[j - 1])); prev = old; } } return row[b.length]; };
  return list.slice().sort((a, b) => d(a, word) - d(b, word))[0];
}

// ---------- expansion ----------
function expand(source, options = {}) {
  const dialect = options.dialect || 'video';
  const read = options.read || (file => fs.readFileSync(file, 'utf8'));
  const tree = toTree(source);
  const defs = {};
  const lines = [], map = [];
  const MAX_LINES = 5000;
  const modules = new Map(), hoisted = [], canvas = {};
  const ev = (src, env, line) => evaluate(src, env, line, dialect);
  const ip = (text, env, line) => interpolate(text, env, line, dialect);

  function emit(text, depth, line) {
    if (lines.length >= MAX_LINES) throw new LangError(line, `expansion exceeds ${MAX_LINES} lines; check repeat counts`);
    lines.push('  '.repeat(depth) + text);
    map.push(line);
  }

  // A module is a file of let / def / data / import lines (plus style and font lines, which are hoisted under
  // the importing file's motion line). Its own motion block, if any, is ignored: importing never emits items.
  function loadModule(ref, fromDir, line, chain) {
    const file = ref.startsWith('orb:') ? path.join(STD, ref.slice(4).replace(/\.orb$/, '') + '.orb')
      : [path.resolve(fromDir, ref), path.resolve(fromDir, ref + '.orb')].find(f => fs.existsSync(f) && fs.statSync(f).isFile()) || path.resolve(fromDir, ref);
    if (chain.includes(file)) throw new LangError(line, `import cycle: ${[...chain, file].map(f => path.basename(f)).join(' -> ')}`);
    if (modules.has(file)) return modules.get(file);
    let text;
    try { text = read(file); } catch {
      let hint = '';
      if (ref.startsWith('orb:')) { try { hint = `; standard modules: ${fs.readdirSync(STD, { recursive: true }).filter(f => String(f).endsWith('.orb')).map(f => 'orb:' + String(f).replace(/\.orb$/, '')).join(', ')}`; } catch {} }
      throw new LangError(line, `module '${ref}' not found (looked at ${file})${hint}`);
    }
    const mod = { env: { ...(canvas.W ? canvas : {}) }, defs: {}, hoist: [], file };
    let moduleTree;
    try { moduleTree = toTree(text); } catch (e) { throw new LangError(line, `in ${path.basename(file)}: ${e.message}`); }
    try { declare(moduleTree.children, mod, path.dirname(file), [...chain, file], line); }
    catch (e) { if (e instanceof LangError && !e.inModule) { const err = new LangError(line, `in ${path.basename(file)}: ${e.message}`); err.inModule = true; throw err; } throw e; }
    modules.set(file, mod);
    return mod;
  }
  function importLine(node, scope, dir, chain, line) {
    let m = node.text.match(/^import\s+"([^"]+)"(?:\s+as\s+([A-Za-z_]\w*))?\s*$/), names = null;
    if (!m) { const f = node.text.match(/^from\s+"([^"]+)"\s+import\s+(.+)$/); if (f) { m = [0, f[1]]; names = f[2].split(',').map(s => s.trim()).filter(Boolean); } }
    if (!m) throw new LangError(node.line, 'write: import "./file.orb"  or  import "orb:std/short" as s  or  from "file.orb" import name, name');
    const mod = loadModule(m[1], dir, line ?? node.line, chain);
    if (names) {
      for (const n of names) {
        if (mod.defs[n]) scope.defs[n] = mod.defs[n];
        else if (Object.hasOwn(mod.env, n)) scope.env[n] = mod.env[n];
        else throw new LangError(node.line, `'${n}' is not defined in '${m[1]}'; it has: ${[...Object.keys(mod.defs), ...Object.keys(mod.env)].join(', ')}`);
      }
    } else if (m[2]) {
      scope.env[m[2]] = { ...mod.env };
      for (const [k, d] of Object.entries(mod.defs)) scope.defs[`${m[2]}.${k}`] = d;
    } else { Object.assign(scope.env, mod.env); Object.assign(scope.defs, mod.defs); }
    for (const h of mod.hoist) if (!scope.hoist.includes(h)) scope.hoist.push(h);
  }
  function declare(nodes, mod, dir, chain, line) {
    for (const node of nodes) {
      const head = node.text.split(/\s+/)[0];
      if (head === 'import' || head === 'from') importLine(node, mod, dir, chain, line);
      else if (head === 'let') mod.env[letName(node)] = letValue(node, mod.env);
      else if (head === 'def') { const d = define(node); d.closure = mod.env; d.scope = mod.defs; mod.defs[d.name] = d; }
      else if (head === 'data' && options.data) mod.env[dataName(node, mod.env)] = dataRows(node, mod.env);
      else if (head === 'style' || head === 'font') mod.hoist.push({ text: ip(node.text, mod.env, node.line), line });
      else if (head === 'motion') continue;
      else throw new LangError(node.line, `a module holds import, let, def, data, style and font lines; found '${head}'`);
    }
  }

  const letName = node => { const m = node.text.match(/^let\s+(\w+)\s*=\s*(.+)$/); if (!m) throw new LangError(node.line, "write 'let name = value'"); return m[1]; };
  function letValue(node, env) {
    const raw = ip(node.text.match(/^let\s+\w+\s*=\s*(.+)$/)[1], env, node.line);
    try { return ev(raw, env, node.line); } catch (e) { return raw; }
  }
  function dataName(node, env) {
    const m = node.text.match(/^data\s+(\w+)(?:\(([^)]+)\))?(?:\s+(.+))?$/);
    if (!m || Object.hasOwn(env, m[1])) throw new LangError(node.line, 'data needs a unique table name');
    return m[1];
  }
  function dataRows(node, env) {
    const m = node.text.match(/^data\s+(\w+)(?:\(([^)]+)\))?(?:\s+(.+))?$/);
    const rows = options.data(m[3] ? ip(m[3], env, node.line) : undefined, node.children, node.line, m[2]);
    if (!Array.isArray(rows) || rows.length > 500 || rows.some(r => !r || Array.isArray(r) || typeof r !== 'object')) throw new LangError(node.line, 'data needs up to 500 records');
    return rows;
  }
  function define(node) {
    const m = node.text.match(/^def\s+([\w.]+)\s*\((.*)\)\s*$/);
    if (!m) throw new LangError(node.line, "write 'def name(param, param=default)'");
    const params = [];
    for (const p of splitParams(m[2], node.line)) {
      const q = p.match(/^([A-Za-z_]\w*)(?:\s*=\s*(.+))?$/s);
      if (!q) throw new LangError(node.line, `parameter '${p}' must look like name or name=default`);
      if (params.some(x => x.name === q[1])) throw new LangError(node.line, `duplicate parameter '${q[1]}'`);
      if (q[2] === undefined && params.some(x => x.fallback !== undefined)) throw new LangError(node.line, `parameter '${q[1]}' has no default but follows one that does`);
      params.push({ name: q[1], fallback: q[2] });
    }
    const slots = new Set();
    (function scan(nodes) { for (const n of nodes) { const s = n.text.match(/^slot(?:\s+([A-Za-z_][\w-]*))?$/); if (s) slots.add(s[1] || ''); else scan(n.children); } })(node.children);
    return { name: m[1], params, body: node.children, line: node.line, slots };
  }
  function splitParams(s, line) {
    const out = []; let start = 0, quote = false, depth = 0;
    for (let i = 0; i <= s.length; i++) {
      const c = s[i];
      if (c === '"') quote = !quote;
      if (!quote) { if (c === '(' || c === '{') depth++; if (c === ')' || c === '}') depth--; }
      if (c === undefined || (c === ',' && !quote && !depth)) { const p = s.slice(start, i).trim(); if (p) out.push(p); start = i + 1; }
    }
    if (quote || depth) throw new LangError(line, 'unclosed quote or bracket in parameters');
    return out;
  }
  function argValue(a, env, line) {
    if (a.str !== undefined) return ip(a.str, env, line);
    if (dialect === 'player') return /^\{/.test(a.raw) ? ev(a.raw.slice(1, -1).trim(), env, line) : a.raw;
    if (/^\[.*\]$/s.test(a.raw)) return ev(ip(a.raw, env, line), env, line);
    return /^\{[^{}]*\}$/.test(a.raw) ? ev(a.raw.slice(1, -1).trim(), env, line) : ip(a.raw, env, line);
  }
  function findDef(head, ctx) { for (const table of ctx.scopes) if (table[head]) return table[head]; return null; }

  function call(d, node, depth, env, ctx) {
    const head = d.name, line = ctx.at ?? node.line;
    if (ctx.callStack.includes(d)) throw new LangError(line, `'${head}' calls itself; recursion is not allowed`);
    const signature = `${head}(${d.params.map(p => p.fallback === undefined ? p.name : `${p.name}=${p.fallback}`).join(', ')})`;
    let args = splitArgs(node.text.slice(node.text.split(/\s+/)[0].length), line, dialect);
    // name=value binds a parameter only when the name is one; anything else stays a positional value.
    args = args.map(a => a.name && !d.params.some(p => p.name === a.name) ? { raw: a.whole } : a);
    const positional = args.filter(a => !a.name), named = args.filter(a => a.name);
    if (positional.length > d.params.length)
      throw new LangError(line, `${head} takes ${d.params.length} value(s) (${d.params.map(p => p.name).join(', ')}), got ${positional.length}`);
    const local = { ...(d.closure || {}), ...env };
    const given = new Set();
    d.params.forEach((p, k) => { if (k < positional.length) { local[p.name] = argValue(positional[k], env, line); given.add(p.name); } });
    for (const a of named) {
      if (given.has(a.name)) throw new LangError(line, `${head}: '${a.name}' is given twice`);
      local[a.name] = argValue(a, env, line); given.add(a.name);
    }
    for (const p of d.params) if (!given.has(p.name)) {
      if (p.fallback === undefined) {
        if (!named.length) throw new LangError(line, `${head} takes ${d.params.length} value(s) (${d.params.map(p => p.name).join(', ')}), got ${positional.length}`);
        throw new LangError(line, `${head} needs '${p.name}'; signature: ${signature}`);
      }
      const [value] = splitArgs(p.fallback, d.line, dialect);
      local[p.name] = argValue(value, local, d.line);
    }
    // Children of the call fill the def's slots: `slot` takes them all, `slot name` takes the children of a `name` block.
    const fills = {};
    if (node.children.length) {
      if (!d.slots.size) throw new LangError(line, `${head} takes no indented children; add a 'slot' line inside 'def ${head}' where they should go`);
      for (const child of node.children) {
        const word = child.text.split(/\s+/)[0];
        if (word && child.text === word && d.slots.has(word)) (fills[word] ||= []).push(...child.children);
        else if (d.slots.has('')) (fills[''] ||= []).push(child);
        else throw new LangError(child.line, `${head} has no default slot; use one of: ${[...d.slots].join(', ')}`);
      }
    }
    run(d.body, depth, local, { callStack: [...ctx.callStack, d], scopes: d.scope ? [d.scope, ...ctx.scopes] : ctx.scopes, slot: { fills, env, ctx }, at: d.closure ? (ctx.at ?? line) : ctx.at });
  }

  function run(nodes, depth, env, ctx) {
    for (const node of nodes) {
      const line = ctx.at ?? node.line;   // lines that come from a module report the call site
      const head = node.text.split(/\s+/)[0];

      if (head === 'import' || head === 'from') {
        if (depth !== 0 || ctx.callStack.length) throw new LangError(line, 'import belongs at the top of the file, before motion');
        const scope = { env, defs, hoist: hoisted };
        importLine(node, scope, options.baseDir || '.', options.file ? [path.resolve(options.file)] : []);
        continue;
      }
      if (head === 'data' && options.data) { env[dataName(node, env)] = dataRows(node, env); continue; }
      if (head === 'let') { env[letName(node)] = letValue(node, env); continue; }
      if (head === 'def') { const d = define(node); defs[d.name] = d; continue; }
      if (head === 'repeat') {
        const m = node.text.match(/^repeat\s+(.+?)\s+as\s+(\w+)\s*$/);
        if (!m) throw new LangError(line, "write 'repeat 3 as i'");
        const count = ev(ip(m[1], env, line), env, line);
        if (Array.isArray(count)) { count.forEach((row, i) => run(node.children, depth, { ...env, [m[2]]: row, i }, ctx)); continue; }
        if (!Number.isFinite(count) || count < 0 || count > 500) throw new LangError(line, `repeat count '${count}' must be between 0 and 500`);
        for (let k = 1; k <= count; k++) run(node.children, depth, { ...env, [m[2]]: k }, ctx);
        continue;
      }
      if (head === 'if') {
        const cond = ev(ip(node.text.slice(2).trim(), env, line), env, line);
        if (cond) run(node.children, depth, env, ctx);
        continue;
      }
      if (head === 'slot' && ctx.slot && /^slot(?:\s+[A-Za-z_][\w-]*)?$/.test(node.text)) {
        const name = node.text.split(/\s+/)[1] || '';
        run(ctx.slot.fills[name] || [], depth, ctx.slot.env, ctx.slot.ctx);
        continue;
      }
      const d = findDef(head, ctx);
      if (d) { call(d, node, depth, env, ctx); continue; }
      if (/^[A-Za-z_]\w*\.[\w.]+$/.test(head)) {
        const space = head.split('.')[0], known = Object.keys(defs).filter(k => k.startsWith(space + '.'));
        if (known.length) throw new LangError(line, `'${head}' is not defined; did you mean '${closest(head, known)}'? ${space} has: ${known.map(k => k.slice(space.length + 1)).join(', ')}`);
      }
      // ordinary line: interpolate and keep, then its children one level deeper
      emit(ip(node.text, env, line), depth, line);
      if (head === 'motion' && depth === 0) for (const h of hoisted.splice(0)) emit(h.text, 1, h.line);
      run(node.children, depth + 1, env, ctx);
    }
  }

  // The canvas size is known from the motion line, so components can place things in proportion: {W*.5}, {H-200}.
  const root = {};
  const motionLine = tree.children.find(n => /^motion(\s|$)/.test(n.text));
  if (motionLine) {
    const presets = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
    [root.W, root.H] = dialect === 'player' ? [1280, 720] : [1920, 1080];
    for (const word of motionLine.text.replace(/"(?:\\.|[^"\\])*"/g, '').split(/\s+/)) {
      const m = word.match(/^(\d+)x(\d+)$/);
      if (m) [root.W, root.H] = [+m[1], +m[2]]; else if (presets[word] && dialect !== 'player') [root.W, root.H] = presets[word];
    }
    Object.assign(canvas, root);
  }
  run(tree.children, 0, root, { callStack: [], scopes: [defs], slot: null });
  return { text: lines.join('\n'), map };
}

module.exports = { expand, evaluate, interpolate, LangError };
