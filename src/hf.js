// HyperFrames target. Deliberately independent of the player parser/runtime.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { textInset, prepareLayout, overlapWarnings } = require('./hf-layout');
const { fitOrbText, installOrbText, contrastInk, updateOrbColor } = require('./hf-text');
const TEXT_FIT = contrastInk.toString()+'\n'+updateOrbColor.toString()+'\n'+fitOrbText.toString()+'\n'+installOrbText.toString()+'\ninstallOrbText();';
const { resolver } = require('./hf-assets');
const { expand } = require('./lang');

class HFError extends Error {
  constructor(line, message) { super(`line ${line}: ${message}`); this.line = line; }
}
const fail = (line, message) => { throw new HFError(line, message); };
const PRESETS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const SFX = { whoosh: .45, pop: .16, ping: .6, click: .08, riser: 1.5 };
const ITEMS = ['video', 'image', 'audio', 'text', 'rect', 'captions', 'group', 'comp', 'html'];
const VERBS = ['to', 'zoom', 'highlight', 'shake', 'flash', 'pulse', 'punch', 'push', 'spin', 'wipe', 'pop', 'count', 'drain', 'karaoke', 'filter', 'type'];
const ANIMATION_LINE = new RegExp(`^(?:${VERBS.join('|')})(?:\\s|$)`);
const ANIMS = ['lift', 'wipe', 'fade', 'rise', 'pop', 'slide-l', 'slide-r', 'type', 'blur', 'grow', 'draw', 'sweep', 'count', 'none'];
const VISUAL = 'radius border shadow clip opacity';
const ALIASES = {colour:'color','background':'bg','border-radius':'radius','alpha':'opacity','font-size':'size','font-family':'font','text-align':'align'};
const COMMON = 'id at until dur layer track in out ease filter origin style drift in-dur out-dur in-x in-y in-scale overlap';
const OPTIONS = {
  motion: 'fps assets voice', bus: 'volume', var: 'label', font: '',
  video: 'trim rate sound volume fit box crop loop length pos radius bg', image: 'fit box pos bg', audio: 'bus volume trim fade',
  text: 'fit box size weight font color align bg radius pad emph words stroke shadow leading spacing border word-pad fill box-shadow whitespace height width sizing bold-size small-size small-color border-left', rect: 'box bg color radius border shadow',
  captions: 'box size highlight max-words', group: 'layout bg box clip border radius shadow', comp: 'vars', html: '',
  to: 'at dur abs from x y scale scale-x scale-y rotate opacity blur ease', zoom: 'at dur abs box hold ease',
  highlight: 'at dur abs box color ease',
  shake: 'at dur abs x y times ease', flash: 'at dur abs color opacity ease',
  pulse: 'at dur abs from scale opacity times ease', punch: 'at dur abs scale ease',
  push: 'at dur abs from to ease', spin: 'at dur abs deg ease',
  wipe: 'at dur abs dir reverse ease', pop: 'at dur abs rotate rest-rotate scale y ease',
  count: 'at dur abs from to ease format', drain: 'at dur abs dir ease',
  karaoke: 'at dur abs color ease',
  filter: 'at dur abs grayscale blur brightness saturate hue contrast ease',
  type: 'at dur abs cursor blink ease',
};
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] !== b[j - 1])); prev = old;
    }
  }
  return row[b.length];
}
function choice(value, allowed, line, kind) {
  if (allowed.includes(value)) return value;
  const closest = allowed.slice().sort((a, b) => distance(a, value) - distance(b, value))[0];
  fail(line, `unknown ${kind} '${value}'; did you mean '${closest}'?${/option/.test(kind) ? ` Valid options: ${[...new Set(allowed)].join(', ')}` : ''}`);
}
function num(value, line, label, min = -Infinity, max = Infinity) {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)s?$/.test(String(value))) fail(line, `${label} must be a number`);
  const n = Number(String(value).replace(/s$/, ''));
  if (!Number.isFinite(n) || n < min || n > max) fail(line, `${label} must be between ${min} and ${max}`);
  return n;
}
function tuple(value, line, label, length = 4) {
  const a = String(value).split(',').map(v => num(v, line, label));
  if (a.length !== length || (length === 4 && (a[2] <= 0 || a[3] <= 0))) fail(line, `${label} needs ${length} comma-separated numbers${length === 4 ? ', with positive width and height' : ''}`);
  return a;
}
function json(value, line) {
  try { const o = JSON.parse(value); if (o && !Array.isArray(o) && typeof o === 'object') return o; } catch {}
  fail(line, 'vars must be a JSON object');
}

// RFC-4180 fields, including quoted commas, escaped quotes and embedded newlines.
function csv(source,line) {
  const rows=[], row=[]; let field='', quoted=false;
  source=source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  for(let i=0;i<=source.length;i++) {
    const c=source[i];
    if(c==='"') {if(quoted && source[i+1]==='"') {field+='"';i++;} else quoted=!quoted;}
    else if(!quoted && (c===',' || c==='\n' || c===undefined)) {
      row.push(field);field='';
      if(c!==',') {if(row.some(Boolean)) rows.push(row.splice(0));else row.length=0;}
    } else if(c!==undefined) field+=c;
  }
  if(quoted) fail(line,'unclosed CSV quote');
  const headers=rows.shift() || [];
  if(!headers.length || new Set(headers).size!==headers.length || headers.some(h=>!/^\w+$/.test(h))) fail(line,'CSV needs unique field names');
  return rows.map(r=>{if(r.length!==headers.length) fail(line,'CSV row width differs from header');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}

function voiceClock(directory,base,line,assets='.') {
  if(directory && !fs.existsSync(path.resolve(base,directory,'timing.json')) && !/\.json$/i.test(directory)) {
    const candidates=[directory+'.words.json',path.join(directory,'voice.words.json'),path.join(directory,'words.json')];
    const file=candidates.find(p=>fs.existsSync(path.resolve(base,p)) && fs.statSync(path.resolve(base,p)).isFile());
    if(file) directory=file;
  }
  let timing; const words=new Map();
  const validWords = ws => Array.isArray(ws) && ws.length && ws.every((w,i)=>w && typeof (w.text ?? w.word)==='string' && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start>=0 && w.end>=w.start && (!i || w.start>=ws[i-1].start));
  if(directory) {
    if (/\.json$/i.test(directory)) {
      const voiceFile=resolver(path.resolve(base),assets,fail)(directory,line);
      let ws;try {ws=JSON.parse(fs.readFileSync(voiceFile,'utf8'));} catch {fail(line,`voice '${directory}' not found`);}
      if(!validWords(ws)) fail(line,'voice needs a nonempty ordered words array');
      words.set('v0',ws.map(w=>({...w,text:w.text ?? w.word})));
      timing={VS:{v0:0},VO_END:Math.max(...ws.map(w=>w.end))};
    } else try {timing=JSON.parse(fs.readFileSync(path.resolve(base,directory,'timing.json'),'utf8'));} catch {fail(line,`voice '${directory}' needs timing.json`);}
    if(!timing?.VS || typeof timing.VS!=='object' || Array.isArray(timing.VS) || !Object.keys(timing.VS).length) fail(line,'voice timing needs VS line offsets');
    num(timing.VO_END,line,'VO_END',0);
    let previous=-1;
    for(const [id,start] of Object.entries(timing.VS)) {num(start,line,`voice ${id} offset`,previous,timing.VO_END);previous=Number(start);}
  }
  const norm=s=>String(s).toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,'');
  return function time(value,line,label,min=-Infinity,max=Infinity) {
    if(!String(value).startsWith('@')) return num(value,line,label,min,max);
    if(String(value).startsWith('@"')) {
      if(!timing || Object.keys(timing.VS).length!==1) fail(line,'@"phrase" needs voice with exactly one line');
      value='@'+Object.keys(timing.VS)[0]+String(value).slice(1);
    }
    const m=String(value).match(/^@(?:(next)\(([\w-]+)\)|([\w-]+?))(?:("(?:\\.|[^"\\])*"))?([+-](?:\d+(?:\.\d*)?|\.\d+))?$/);
    if(!m) fail(line,`invalid voice time '${value}'`);
    const rawId=m[2]||m[3], id=rawId==='voice' && words.has('v0') ? 'v0':rawId, phrase=m[4] ? JSON.parse(m[4]) : '';
    if(!timing) fail(line,`voice ${id}${phrase?` phrase '${phrase}'`:''} needs motion voice="directory"`);
    let result;
    if(id==='end' && !m[1] && !phrase) result=timing.VO_END;
    else {
      if(!Object.hasOwn(timing.VS,id)) fail(line,`voice line '${id}'${phrase?` phrase '${phrase}'`:''} not found`);
      result=Number(timing.VS[id]);
      if(m[1]) {if(phrase) fail(line,`voice ${id}: next does not accept phrase '${phrase}'`);const ids=Object.keys(timing.VS);result=timing.VS[ids[ids.indexOf(id)+1]] ?? timing.VO_END;}
      else if(m[4]) {
        if(!words.has(id)) {
          let ws;try {ws=JSON.parse(fs.readFileSync(path.resolve(base,directory,'words',id+'.words.json'),'utf8'));} catch {fail(line,`voice ${id} phrase '${phrase}': words file not found`);}
          if(!validWords(ws)) fail(line,`voice ${id} phrase '${phrase}': invalid word timings`);
          words.set(id,ws.map(w=>({...w,text:w.text ?? w.word})));
        }
        const ws=words.get(id), toks=phrase.split(/\s+/).map(norm).filter(Boolean);
        const index=ws.findIndex((_,i)=>toks.length && toks.every((t,j)=>norm(ws[i+j]?.text ?? '')===t));
        if(index<0) fail(line,`voice ${id}: phrase '${phrase}' not found`);
        result+=ws[index].start;
      }
    }
    return num(Math.round((Number(result)+Number(m[5]||0))*1e6)/1e6,line,label,min,max);
  };
}

// Protect raw HTML, JSON and Studio bindings from the existing expression expander.
// The player language stays unchanged. Raw HTML is literal, including blank lines/comments.
function expanded(source, options) {
  const saved = [];
  const hide = s => `__HF_LITERAL_${saved.push(s) - 1}__`;
  const protect = source => { let rawIndent = null; return source.split(/\r?\n/).map(line => {
    const indent = line.match(/^ */)[0].length;
    if (rawIndent !== null && indent === rawIndent + 2 && ANIMATION_LINE.test(line.trim())) rawIndent = null;
    if (rawIndent !== null && (!line.trim() || indent > rawIndent)) return ' '.repeat(rawIndent + 2) + hide(line.slice(rawIndent + 2));
    rawIndent = /^\s*html(?:\s|$)/.test(line) ? indent : null;
    return line.replace(/vars=(\{.*\})|\{\$[\w-]+\}|(format=)?"(?:\\.|[^"\\])*"/g, (s, obj, format) => {
      if (obj) return 'vars=' + hide(obj);
      if (s.startsWith('{$')) return hide(s);
      if (format) return s.replace(/\\([{}])|[{}#]/g, (all, escaped) => hide(escaped || all));   // number formats are literal: {n:,}
      // Inside quoted text a {...} group is an expression only when it reads like one. Number formats ({n:,}),
      // rich-text options ({color=#fff}), Studio bindings and stray braces stay literal.
      return s.replace(/\\([{}])|\{[^{}]*\}|[{}]|#/g,(all,escaped)=>{
        if(escaped) return hide(escaped);
        if(all.length<3) return hide(all);
        const expr=all.slice(1,-1);
        if(/^\$[\w-]+$/.test(expr) || /^(?:n|value):.+$/.test(expr)) return hide(all);
        if(expr.replace(/[=!<>]=/g,'').includes('=')) return hide(all);
        return /^[\w.()+*\/%<>=!, \-\[\]?:'&|#]+$/.test(expr) ? all : hide(all);
      });
    });
  }).join('\n'); };
  const safe = protect(source);
  const restore = s => { while(/__HF_LITERAL_\d+__/.test(s)) s=s.replace(/__HF_LITERAL_(\d+)__/g, (_,i)=>saved[+i]); return s; };
  const out = expand(safe, {dialect:'video', baseDir: options.baseDir || '.', file: options.sourceFile, read: file => protect(fs.readFileSync(file,'utf8')), data(ref, children, line, columns) {
    if(columns) {
      if(ref) fail(line,'inline CSV columns cannot also specify a file');
      if(children.some(row=>row.children.length)) fail(line,'CSV rows cannot have children');
      return csv(columns+'\n'+children.map(row=>restore(row.text)).join('\n'),line);
    }
    if (!ref) return children.map(row => {
      const parsed = tokens(restore(row.text), row.line);
      if (parsed.args.length || row.children.length) fail(row.line, 'data rows need field=value options');
      return parsed.named;
    });
    if (children.length) fail(line, 'file data cannot also have inline rows');
    const {args} = tokens(restore(ref),line);
    if(args.length!==1) fail(line,'data needs one JSON or CSV file');
    const file=path.resolve(options.baseDir || '.',args[0]);
    let content; try {content=fs.readFileSync(file,'utf8');} catch {fail(line,`data file '${args[0]}' not found`);}
    try {return /\.csv$/i.test(file) ? csv(content,line) : JSON.parse(content);} catch(e) {if(e instanceof HFError) throw e; fail(line,`invalid data file '${args[0]}': ${e.message}`);}
  }});
  out.text = restore(out.text);
  return out;
}

// Quoted strings and JSON may contain spaces, escaped quotes and '='.
function tokens(s, line) {
  const parts = []; let start = 0, quote = false, escape = false, braces = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (quote && c === '\\') { escape = true; continue; }
    if (c === '"') quote = !quote;
    if (!quote) {
      if (c === '{') braces++;
      if (c === '}') braces--;
      if ((c === undefined || /\s/.test(c)) && braces === 0) {
        if (i > start) parts.push(s.slice(start, i)); start = i + 1;
      }
    }
  }
  if (quote || braces) fail(line, 'unclosed quote or JSON object');
  const args = [], named = {};
  const unquote = s => { if (s[0] !== '"') return s; try { return JSON.parse(s); } catch { fail(line, 'invalid quoted string'); } };
  for (const p of parts) {
    const m = p.match(/^([\w-]+)=(.*)$/s);
    if (m) { const key=ALIASES[m[1]]||m[1];if (Object.hasOwn(named,key)) fail(line, `duplicate option '${key}'`); named[key] = unquote(m[2]); }
    else args.push(unquote(p));
  }
  return { args, named };
}
function timeList(value) {
  const source=String(value), parts=[];let start=0,quote=false,escape=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(escape) {escape=false;continue;}
    if(quote && c==='\\') {escape=true;continue;}
    if(c==='"') quote=!quote;
    if(c===',' && !quote) {parts.push(source.slice(start,i));start=i+1;}
  }
  parts.push(source.slice(start));return parts;
}
function parse(source, options = {}) {
  const out = expanded(source, options), lines = out.text.split('\n'), styles = new Map();
  let motion; const stack = [], ids = new Set(['root', 'main', 'voice', 'music', 'sfx']); let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = out.map[i] || i + 1, indent = raw.match(/^ */)[0].length;
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (indent % 2) fail(line, 'indent with 2 spaces per level');
    const body = raw.trim(), word = body.split(/\s/)[0], kind = word === 'sfx' ? 'audio' : word;
    let { args, named: o } = tokens(body.slice(word.length).trim(), line);
    if (kind === 'style') {
      if(!motion) fail(line,"file must start with 'motion'");
      if (indent !== 2 || args.length!==2 || args[1]!=='=' || !/^[A-Za-z][\w-]*$/.test(args[0]) || styles.has(args[0])) fail(line,'style needs a unique name = options at indent 2');
      for(const key of Object.keys(o)) choice(key,(COMMON+' '+VISUAL+' '+OPTIONS.text+' '+OPTIONS.video).split(' '),line,'style option');
      if(o.style) {
        const parent=styles.get(o.style);if(!parent) fail(line,`unknown style '${o.style}'`);
        o={...parent,...o};delete o.style;
      }
      styles.set(args[0],o); continue;
    }
    if(o.style) {
      const preset=styles.get(o.style); if(!preset) fail(line,`unknown style '${o.style}'`);
      o={...preset,...o};
    }
    // On text, shadow is the text shadow and box-shadow is the box's. Everywhere else they are the same thing.
    if (!['text', 'captions'].includes(kind) && o['box-shadow'] !== undefined) {
      if (o.shadow !== undefined) fail(line, "duplicate option 'shadow'");
      o.shadow = o['box-shadow']; delete o['box-shadow'];
    }
    if (['scene', 'use', 'svg', 'speed'].includes(kind)) fail(line, `'${kind}' is outside Phase 1`);
    choice(kind, ['motion', 'bus', 'var', 'font', ...ITEMS, ...VERBS], line, 'word');
    const allowed = ((ITEMS.includes(kind) ? COMMON + ' '+(kind!=='audio'?VISUAL+' ':'') : '') + OPTIONS[kind]+(kind==='captions'?' '+OPTIONS.text:'')).split(' ').filter(Boolean);
    for (const key of Object.keys(o)) choice(key, allowed, line, 'option');
    if(kind==='audio' && Object.hasOwn(SFX,String(args[0]).replace(/\.(mp3|wav|ogg|m4a)$/i,''))) {const key=String(args[0]).replace(/\.(mp3|wav|ogg|m4a)$/i,'');o.bus ??= 'sfx';o.dur ??= SFX[key];}
    if(kind==='captions') o.at ??= 0;
    if(word==='sfx') o.bus ??= 'sfx';
    const node = { kind, args, o, line, children: [], animations: [] };
    if (kind === 'motion') {
      if (motion || indent) fail(line, 'one motion line must start the file');
      motion = { title: 'Untitled', assets: o.assets || '.', voice:o.voice, fonts:[], width: 1920, height: 1080, fps: num(o.fps ?? 30, line, 'fps', 1, 240), duration: null, children: [], variables: [], buses: { voice: 1, music: 0.07, sfx: 0.5 } };
      motion.time = voiceClock(o.voice, options.baseDir || '.', line,o.assets||'.');
      for (const a of args) {
        if (PRESETS[a]) [motion.width, motion.height] = PRESETS[a];
        else if (/^\d+x\d+$/.test(a)) [motion.width, motion.height] = a.split('x').map(v => num(v, line, 'dimensions', 1));
        else if (/^[\d.]+s$/.test(a) || a.startsWith('@')) motion.duration = motion.time(a, line, 'duration', 0.001);
        else if (motion.title === 'Untitled') motion.title = a;
        else fail(line, `unexpected '${a}' on motion line`);
      }
      continue;
    }
    if (!motion) fail(line, "file must start with 'motion'");
    if(kind==='font') {
      if(indent!==2 || args.length!==3 || args[1]!=='as' || !/^[A-Za-z][\w-]*$/.test(args[2]) || motion.fonts.some(f=>f.name===args[2])) fail(line,'font needs "file.woff2" as UniqueName at indent 2');
      motion.fonts.push({file:args[0],name:args[2],line}); continue;
    }
    if (kind === 'bus' || kind === 'var') {
      if (indent !== 2) fail(line, `${kind} belongs at indent 2`);
      if (kind === 'bus') { choice(args[0], ['voice', 'music', 'sfx'], line, 'bus'); motion.buses[args[0]] = num(o.volume ?? motion.buses[args[0]], line, 'volume', 0, 3.98); }
      else {
        const [id, type, value] = args;
        if (!/^[A-Za-z][\w-]*$/.test(id || '') || motion.variables.some(v => v.id === id)) fail(line, 'variable needs a unique name');
        choice(type, ['string', 'number', 'color', 'boolean'], line, 'variable type');
        if (value === undefined || args.length !== 3) fail(line, 'var needs name, type and default');
        if (type === 'boolean') choice(value, ['true', 'false'], line, 'boolean');
        motion.variables.push({ id, type, default: type === 'number' ? num(value, line, 'default') : type === 'boolean' ? value === 'true' : value, label: o.label || id });
      }
      continue;
    }
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.node;
    if (VERBS.includes(kind)) {
      if (!parent || indent !== stack.at(-1).indent + 2) fail(line, `${kind} needs an item parent`);
      if (['count', 'karaoke', 'type'].includes(kind) && parent.kind !== 'text') fail(line, `${kind} needs a text parent`);
      if (args.length) fail(line, `${kind} takes only named options`);
      parent.animations.push(node); continue;
    }
    if ((!parent && indent !== 2) || (parent && (parent.kind !== 'group' || indent !== stack.at(-1).indent + 2))) fail(line, 'only group can contain items; indent with 2 spaces per level');
    index++; node.id = o.id || `${kind}-${index}`;
    o.track ??= index;
    const generatedIds = [node.id, `${node.id}-motion`];
    if (!/^[A-Za-z][\w-]*$/.test(node.id) || generatedIds.some(id => ids.has(id))) fail(line, `id '${node.id}' must be unique and start with a letter`);
    generatedIds.forEach(id => ids.add(id));
    if (kind === 'text' && args.length > 1) args.splice(0, args.length, args.join(' '));   // forgive unquoted text
    if (['video', 'image', 'audio', 'text', 'captions', 'comp'].includes(kind) ? args.length !== 1 : args.length !== 0) fail(line, `${kind} ${['video', 'image', 'audio', 'text', 'captions', 'comp'].includes(kind) ? 'needs one quoted value' : 'takes only named options'}`);
    for (const edge of ['in', 'out']) if (o[edge]) choice(o[edge].replace(/-out$/, ''), ANIMS, line, 'animation');
    if (o.box) tuple(o.box, line, 'box');
    if (kind === 'video') { choice(o.sound || 'off', ['on', 'off'], line, 'sound'); choice(o.loop || 'off', ['on','off'],line,'loop'); num(o.rate ?? 1, line, 'rate', 0.1, 10); }
    if (['video', 'image'].includes(kind)) choice(o.fit || 'contain', ['cover', 'contain', 'fill', 'none', 'scale-down'], line, 'fit');
    if (kind === 'audio') { choice(o.bus || 'voice', ['voice', 'music', 'sfx'], line, 'bus'); if (o.fade) o.fade=timeList(o.fade).map(t=>motion.time(t,line,'fade',0)).join(','); }
    if (o.volume !== undefined) num(o.volume, line, 'volume', 0, 3.98);
    if (o.trim !== undefined) o.trim=motion.time(o.trim, line, 'trim', 0);
    if(kind==='group' && o.layout) choice(o.layout,['stack'],line,'layout');
    if (kind === 'comp' && o.vars) json(o.vars, line);
    (parent ? parent.children : motion.children).push(node);
    if (kind === 'html') {
      const chunks = [];
      while (i + 1 < lines.length && (lines[i + 1].match(/^ */)[0].length > indent || !lines[i + 1].trim())) {
        if (lines[i + 1].match(/^ */)[0].length === indent + 2 && ANIMATION_LINE.test(lines[i + 1].trim())) break;
        chunks.push(lines[++i].slice(indent + 2));
      }
      node.raw = chunks.join('\n');
      if (!node.raw.trim()) fail(line, 'html needs indented markup');
    }
    stack.push({ indent, node });
  }
  if (!motion || !motion.children.length) fail(1, 'add motion and at least one timed item');
  function time(nodes, offset, limit, together = false) {
    let prev;
    for (const n of nodes) {
      const a = n.o.at === undefined && together ? 0 : n.o.at;
      const local = a === undefined ? (prev ? prev.start + prev.duration - offset : 0) : a === '<' ? (prev ? prev.start - offset : 0) : String(a).startsWith('+') ? (prev ? prev.start + prev.duration - offset : 0) + motion.time(a.slice(1), n.line, 'at', 0) : motion.time(a, n.line, 'at', 0) - (String(a).startsWith('@') ? offset : 0);
      n.start = offset + local;
      if(n.o.until!==undefined && n.o.dur!==undefined) fail(n.line,'choose until or dur');
      n.duration = n.o.until!==undefined ? motion.time(n.o.until,n.line,'until',0)-(String(n.o.until).startsWith('@')?n.start:local) : n.o.dur === undefined ? (limit === null ? 3 : limit - local) : motion.time(n.o.dur, n.line, 'dur', 0.001);
      if (n.duration <= 0) fail(n.line, 'dur must be positive; specify dur or a longer motion');
      if (limit !== null && local + n.duration > limit + 1e-6) { (motion.parseWarnings ||= []).push({ line: n.line, message: `trimmed to its parent's end (${+(limit - local).toFixed(3)} s)` }); n.duration = limit - local; }
      if (n.duration <= 0) fail(n.line, 'dur must be positive; specify dur or a longer motion');
      time(n.children, n.start, n.duration, n.o.layout === 'stack'); prev = n;
    }
  }
  time(motion.children, 0, motion.duration);
  motion.duration ??= Math.max(...motion.children.map(n => n.start + n.duration));
  return motion;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const js = o => JSON.stringify(o).replace(/</g, '\\u003c');
const attrs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';
const ease = (v = 'out') => ({ out: 'power3.out', inout: 'power2.inOut', back: 'back.out(1.7)', linear: 'none', expo: 'expo.out', spring: 'elastic.out(1,0.4)' }[v] || v);
const pose = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, filter: 'blur(0px)' };
// Clip reveals (wipe, draw, type, drain) open to 50% beyond the box on every side: outlines, shadows and tall
// glyphs reach past a text box, and a clip at the box edge would cut them in a straight line.
function animation(name) {
  return ({ none: {}, fade: { opacity: 0 }, lift: { opacity: 0, y: 24 }, rise: { opacity: 0, y: 60 }, pop: { opacity: 0, scale: 0.8 }, 'slide-l': { opacity: 0, x: -80 }, 'slide-r': { opacity: 0, x: 80 }, blur: { opacity: 0, filter: 'blur(12px)' }, grow: { scale: 0 }, draw: { clipPath: 'inset(-50% 100% -50% -50%)' }, wipe: { clipPath: 'inset(-50% 100% -50% -50%)' }, type: { clipPath: 'inset(-50% 100% -50% -50%)' }, sweep: { scale: 0, opacity: 0 }, count: { opacity: 0, y: 12 } })[name.replace(/-out$/, '')];
}

const STATE_AT = `function stateAt(target,fallback,time){const previous=tl.time();tl.seek(time,true);const state=Object.fromEntries(Object.keys(fallback).map(key=>[key,gsap.getProperty(target,key)]));tl.seek(previous,true);return state;}`;

const FORMAT_NUMBER = `function formatNumber(value,format){return format.replace(/\\{(?:(?:n|value)(?::(,|0?\\d+|\\.\\d+f))?)?\\}/g,(_,spec)=>{if(spec?.endsWith('f'))return value.toFixed(Number(spec.slice(1,-1)));const n=Math.round(value);if(spec===',')return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');return spec?String(n).padStart(Number(spec),'0'):String(n);});}`;

function build(source, outDir, options = {}) {
  const m = parse(source,options), base = path.resolve(options.baseDir || '.'), dest = path.resolve(outDir);
  if (base === dest || base.startsWith(dest + path.sep)) fail(1, 'output must not contain the source directory');
  fs.mkdirSync(path.join(dest, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'compositions'), { recursive: true });
  const usedBuses = new Set();
  const assetBase = path.resolve(base, m.assets), fonts = new Map();
  const copied = new Map(), busAudio = { voice: [], music: [], sfx: [] };
  const clock=m.time, resolveAsset=resolver(base,m.assets,fail);
  const renderIds=new Set();
  function collectIds(nodes) {for(const n of nodes) {renderIds.add(n.id);renderIds.add(n.id+'-motion');collectIds(n.children);}}
  collectIds(m.children);
  m.warnings=[];
  const warn=(line,message)=>{m.warnings.push({line,message});options.onWarning?.(`line ${line}: ${message}`);};
  for (const w of m.parseWarnings || []) warn(w.line, w.message);
  prepareLayout(m,warn);
  overlapWarnings(m,warn);
  let tweens = [], origin = 0, highlightIndex = 0;
  function asset(ref, line, relative = assetBase) {
    if (/^(?:data:|https?:|\/\/)/.test(ref)) return ref;
    const clean = ref.replace(/[?#].*$/, '');
    const file = resolveAsset(clean,line,relative);
    if (copied.has(file)) return copied.get(file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(line, `asset '${ref}' not found`);
    const hash = crypto.createHash('sha256').update(file).digest('hex').slice(0, 10);
    const name = `assets/${hash}-${path.basename(file).replace(/[^\w.-]/g, '-')}`;
    fs.copyFileSync(file, path.join(dest, name)); copied.set(file, name); return name;
  }
  function normalize(html, id, line) {
    const root = html.match(/<[^>]+\bid=["']root["'][^>]*>/);
    if (!root) fail(line, 'composition needs id="root"');
    const previous = root[0].match(/data-composition-id=["']([^"']+)["']/)?.[1];
    const tag = previous ? root[0].replace(/data-composition-id=["'][^"']+["']/, `data-composition-id="${id}"`) : root[0].replace(/>$/, ` data-composition-id="${id}">`);
    html = html.replace(root[0], tag);
    if (previous) html = html.replace(/(__timelines\s*\[)\s*["']([^"']+)["']\s*(\])/g, (all, a, key, b) => key === previous ? `${a}"${id}"${b}` : all);
    if (!/__timelines\s*\[/.test(html)) {
      const script = `<script>window.__timelines[${js(id)}]=gsap.timeline({paused:true});</script>`;
      html = /<\/template>/.test(html) ? html.replace('</template>', script + '</template>') : html + script;
    }
    return /<template[\s>]/.test(html) ? html : `<template>${html}</template>`;
  }
  const importing = new Set();
  function importComposition(ref, id, line, relative = base) {
    const file = resolveAsset(ref,line,relative);
    if (importing.has(file)) fail(line, `composition import cycle at '${ref}'`);
    let html; try { html = fs.readFileSync(file, 'utf8'); } catch { fail(line, `composition '${ref}' not found`); }
    if (!/<template[\s>]/.test(html)) fail(line, 'comp needs a template with #root');
    importing.add(file);
    html = rewrite(html, line, path.dirname(file));
    importing.delete(file);
    return normalize(html, id, line);
  }
  function rewrite(html, line, relative = base) {
    for (const match of html.matchAll(/data-audio-group=["']([^"']+)["']/g)) usedBuses.add(match[1]);
    html = html.replace(/<[^>]+data-composition-src=["'][^"']+["'][^>]*>/g, tag => {
      const ref = tag.match(/data-composition-src=["']([^"']+)["']/)[1];
      const id = tag.match(/data-composition-id=["']([^"']+)["']/)?.[1];
      if (!/^[A-Za-z][\w-]*$/.test(id || '')) fail(line, 'composition host needs a valid data-composition-id');
      const filename = `compositions/${id}.html`;
      fs.writeFileSync(path.join(dest, filename), importComposition(ref, id, line, relative));
      return tag.replace(/data-composition-src=["'][^"']+["']/, `data-composition-src="${filename}"`);
    });
    return html.replace(/(?<![\w-])(src|href)=(['"])([^'"]+)\2|url\(\s*(['"]?)([^)'"\s]+)\4\s*\)/g, (all, attr, q, ref, uq, url) => {
      const r = ref || url;
      if (/^(?:https?:|data:|#|\/\/)/.test(r)) return all;
      // HF paths are project-root-relative, including in sub-compositions.
      const dir = fs.existsSync(path.resolve(base, r)) ? base : relative;
      const target = asset(r, line, dir);
      return attr ? `${attr}=${q}${target}${q}` : `url("${target}")`;
    });
  }
  function binding(value, attr) {
    const match = String(value).match(/^\{\$([\w-]+)\}$/);
    if (match) {
      const v = m.variables.find(v => v.id === match[1]);
      if (!v) fail(1, `unknown variable '${match[1]}'`);
      return { value: v.default, attr: { [`data-var-${attr}`]: v.id } };
    }
    // Mixed text bindings update through the same Studio variable lookup on init.
    return { value: String(value).replace(/\{\$([\w-]+)\}/g, (_, id) => {
      const v = m.variables.find(v => v.id === id); if (!v) fail(1, `unknown variable '${id}'`); return v.default;
    }), attr: {} };
  }
  function css(value) { return String(value).replace(/\{\$([\w-]+)\}/g, (_, id) => { if (!m.variables.some(v => v.id === id)) fail(1, `unknown variable '${id}'`); return `var(--${id})`; }); }
  function radiusCss(value, line) { return String(value ?? 0).split(/[,\s]+/).filter(Boolean).map(v => numericCss(v, line, 'radius', 0, Infinity, true)).join(' '); }
  function numericCss(value, line, label, min, max, pixels = false) {
    const match = String(value).match(/^\{\$([\w-]+)\}$/);
    if (!match) return num(value, line, label, min, max) + (pixels ? 'px' : '');
    const variable = m.variables.find(v => v.id === match[1] && v.type === 'number');
    if (!variable) fail(line, `${label} needs a number variable`);
    num(variable.default, line, label, min, max);
    return pixels ? `calc(${css(value)} * 1px)` : css(value);
  }
  function tween(target, from, to, at, duration, e = 'out', first = false, sample = false) {
    const initial = sample ? `stateAt(${js(target)},${js(from)},${at})` : js(from);
    tweens.push(`tl.fromTo(${js(target)},${initial},${js({ ...to, duration, ease: ease(e), immediateRender: first })},${at});`);
  }
  function wordHighlights(n, words, color, absolute = false, line = n.line, duration = .08, e = 'power1.out') {
    const count = n.wordCount;
    if (words.length !== count) fail(line, `word timing count ${words.length} does not match text word count ${count}`);
    let previous = -1;
    words.forEach((word, i) => {
      const start = clock(word.start,line,'word start',0)-(String(word.start).startsWith('@') && !absolute ? n.start : 0);
      const end = clock(word.end,line,'word end',0)-(String(word.end).startsWith('@') && !absolute ? n.start : 0);
      num(start,line,'word start',0);num(end,line,'word end',start+.001);
      const local = start - (absolute ? n.start : 0), finish = end - (absolute ? n.start : 0);
      if (start < previous || local < 0 || finish > n.duration + 1e-6) fail(line, 'word times must be ordered and fit inside text');
      previous = end;
      const at = n.start - origin + local, baseColor = n.wordColors?.[i] || (n.o.color==='auto'?'inherit':n.o.color) || '#ffffff';
      tween(`#${n.id}-word-${i}`, {color:baseColor,scale:1}, {color,scale:1.12}, at, Math.min(duration,n.duration-local), e, false);
      if (i < count - 1) tween(`#${n.id}-word-${i}`, {color,scale:1.12}, {color:baseColor,scale:1}, n.start-origin+finish, Math.min(duration, (n.duration-finish)), e, false);
    });
  }
  function animate(n, target, box) {
    const basePose={...pose,opacity:num(n.o.opacity??1,n.line,'opacity',0,1)};
    const state = { ...basePose, filter: n.o.filter || pose.filter }, decorations = []; let first = true;
    const emit = (from, to, at, dur, e, sample = false) => { tween(target, from, to, at, dur, e, first, sample && !first); first = false; Object.assign(state, to); };
    const entrance={...animation(n.o.in||'none')};
    for(const [key,prop] of [['in-x','x'],['in-y','y'],['in-scale','scale']]) if(n.o[key]!==undefined) entrance[prop]=num(n.o[key],n.line,key);
    if (n.o.in && n.o.in !== 'none') emit({ ...basePose, filter:state.filter, clipPath: 'inset(-50% -50% -50% -50%)', ...entrance }, { ...basePose, filter:state.filter, clipPath: 'inset(-50% -50% -50% -50%)' }, n.start - origin, Math.min(clock(n.o['in-dur'] ?? .4,n.line,'in-dur',.001), n.duration / 3), n.o.ease);
    if(n.o.drift!==undefined) {
      const drift=n.o.drift==='on' ? -12 : n.o.drift==='off' ? 0 : num(n.o.drift,n.line,'drift');
      if(drift && n.duration>2.5) emit({y:0},{y:drift},n.start-origin+.45,n.duration-.5,'none');
    }
    const events = n.animations.flatMap(a => a.kind === 'karaoke'
      ? [{ ...a, at: n.start - origin }]
      : timeList(a.o.at ?? 0).map(t => ({ ...a, at: (a.o.abs === 'on' || t.startsWith('@') ? 0 : n.start) + clock(t, a.line, 'at', 0) - origin }))
    ).sort((a, b) => a.at - b.at);
    for (const a of events) {
      const o = a.o, dur = clock(o.dur ?? (a.kind === 'highlight' ? 2 : 0.6), a.line, 'dur', 0.001);
      if (o.abs) choice(o.abs, ['on', 'off'], a.line, 'abs');
      const end = a.at + (a.kind === 'karaoke' ? 0 : dur) + (a.kind === 'zoom' ? clock(o.hold ?? 0, a.line, 'hold', 0) + dur : 0);
      if (a.at < n.start - origin || end > n.start - origin + n.duration + 1e-6) fail(a.line, 'animation must fit inside its item');
      if (a.kind === 'to') {
        const to = {};
        for (const k of ['x', 'y', 'scale', 'scale-x', 'scale-y', 'rotate', 'opacity', 'blur']) if (o[k] !== undefined) {
          const v = num(o[k], a.line, k, ['scale', 'scale-x', 'scale-y', 'blur'].includes(k) ? 0 : k === 'opacity' ? 0 : -Infinity, k === 'opacity' ? 1 : Infinity);
          to[({'rotate':'rotation','blur':'filter','scale-x':'scaleX','scale-y':'scaleY'}[k] || k)] = k === 'blur' ? `blur(${v}px)` : v;
        }
        if (!Object.keys(to).length) fail(a.line, 'to needs at least one animated property');
        if (o.from !== undefined && Object.keys(to).length !== 1) fail(a.line,'to from= needs exactly one animated property');
        const from = Object.fromEntries(Object.keys(to).map(k => [k, state[k] ?? (k === 'scaleX' || k === 'scaleY' ? 1 : 0)]));
        if (o.from !== undefined) {
          const key = Object.keys(to)[0], value = num(o.from,a.line,'from',['opacity','scale','scaleX','scaleY','filter'].includes(key)?0:-Infinity,key==='opacity'?1:Infinity);
          from[key] = key === 'filter' ? `blur(${value}px)` : value;
        }
        emit(from, to, a.at, dur, o.ease || n.o.ease, o.from === undefined);
      } else if (a.kind === 'filter') {
        const spec = {grayscale:['grayscale','',0,1],blur:['blur','px',0],brightness:['brightness','',1],saturate:['saturate','',1],hue:['hue-rotate','deg',0],contrast:['contrast','',1]};
        const from = {}, to = {};
        let changed = false;
        for (const [key,[fn,unit,neutral,max]] of Object.entries(spec)) {
          const previous = state.filter.match(new RegExp(fn+'\\((-?[0-9.]+)(?:px|deg)?\\)'));
          from[key] = previous ? Number(previous[1]) : neutral;
          to[key] = o[key] === undefined ? from[key] : num(o[key], a.line, key, key === 'hue' ? -Infinity : 0, max ?? Infinity);
          changed ||= o[key] !== undefined;
        }
        if (!changed) fail(a.line, 'filter needs at least one filter property');
        const value = values => Object.entries(spec).map(([k,[fn,unit]])=>`${fn}(${values[k]}${unit})`).join(' ');
        emit({filter:value(from)}, {filter:value(to)}, a.at, dur, o.ease || 'linear', true);
      } else if (a.kind === 'type') {
        if (!n.charCount) fail(a.line, 'type needs nonempty text');
        for (let i=0;i<n.charCount;i++) tween(`#${n.id}-char-${i}`, {display:'none'}, {display:'inline'}, a.at+i*dur/n.charCount, 0, 'none', false);
        if (o.cursor && o.blink !== undefined) {
          const blink = clock(o.blink,a.line,'blink',0.02);
          for (let at=a.at+dur+blink,i=0;at<n.start-origin+n.duration;at+=blink,i++) tween(`#${n.id}-cursor`, {opacity:i%2?0:1}, {opacity:i%2?1:0}, at, 0, 'none', false);
        }
      } else if (a.kind === 'zoom') {
        const [x, y, w, h] = tuple(o.box, a.line, 'box'), scale = Math.max(box[2] / w, box[3] / h);
        const from = { x: state.x, y: state.y, scale: state.scale, transformOrigin: '0 0' };
        const to = { x: -x * scale + (box[2] - w * scale) / 2, y: -y * scale + (box[3] - h * scale) / 2, scale, transformOrigin: '0 0' };
        emit(from, to, a.at, dur, o.ease || n.o.ease);
        emit(to, from, a.at + dur + clock(o.hold ?? 0, a.line, 'hold', 0), dur, o.ease || n.o.ease);
      } else if (a.kind === 'highlight') {
        const [x, y, w, h] = tuple(o.box, a.line, 'box'), id = `${n.id}-highlight-${highlightIndex++}`;
        decorations.push(`<div${attrs({ id, class: 'clip', 'data-start': a.at, 'data-duration': dur, 'data-track-index': n.o.track || 1, 'data-track-kind': 'graphics', style: `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${Number(n.o.layer ?? 1) + 1};pointer-events:none` })}><div id="${id}-ink" style="width:100%;height:100%;border:4px solid ${esc(css(o.color || '#ffe600'))};box-shadow:0 0 22px ${esc(css(o.color || '#ffe600'))};border-radius:10px"></div></div>`);
        tween(`#${id}-ink`, { opacity: 0, clipPath: 'inset(-50% 100% -50% -50%)' }, { opacity: 1, clipPath: 'inset(-50% -50% -50% -50%)' }, a.at, Math.min(0.2, dur / 2), o.ease, true);
      } else if (a.kind === 'flash') {
        const id = `${n.id}-flash-${highlightIndex++}`;
        decorations.push(`<div id="${id}" data-layout-ignore style="position:absolute;inset:0;background:${esc(css(o.color==='auto'?'#ffffff':o.color || '#ffffff'))};opacity:0;pointer-events:none;z-index:100"></div>`);
        tween(`#${id}`, { opacity: num(o.opacity ?? 0.6, a.line, 'opacity', 0, 1) }, { opacity: 0 }, a.at, dur, o.ease || 'linear', false);
      } else if (a.kind === 'count') {
        const from = num(o.from ?? 0, a.line, 'from'), to = num(o.to ?? 100, a.line, 'to');
        const format = String(o.format ?? '{}');
        if (!/\{(?:(?:n|value)(?::(?:,|0?\d+|\.\d+f))?)?\}/.test(format)) fail(a.line, 'format needs {}, {n}, {n:,}, {n:04} or {n:.2f}');
        const key = `counter${highlightIndex++}`;
        // Property writes run even on suppressEvents=true seeks. Callbacks do not.
        tweens.push(`let ${key}Value=${from};const ${key}=Object.defineProperty({},"v",{get:()=>${key}Value,set:value=>{${key}Value=value;document.getElementById(${js(n.id + '-value')}).textContent=formatNumber(value,${js(format)});}});tl.fromTo(${key},{v:${from}},{v:${to},duration:${dur},ease:${js(ease(o.ease || 'linear'))},immediateRender:false},${a.at});`);
      } else if (a.kind === 'karaoke') {
        const times = timeList(o.at ?? 0).map(t => clock(t,a.line,'at',0)-(t.startsWith('@') && o.abs!=='on' ? n.start : 0));
        wordHighlights(n, times.map((t,i) => ({start:t, end:times[i+1] ?? (n.duration - (a.o.abs === 'on' ? -n.start : 0))})), o.color || '#ffe600', a.o.abs === 'on', a.line, clock(o.dur ?? .08,a.line,'dur',.001), o.ease || 'power1.out');
      } else if (a.kind === 'push') {
        const view = (v, fallback) => {
          if (v === undefined) return fallback;
          const parts = String(v).split(',');
          if (parts.length === 1) return { scale: num(v, a.line, 'scale', 0.001), x: 0, y: 0 };
          if (parts.length !== 3) fail(a.line, 'push from/to needs scale or scale,x,y');
          return { scale: num(parts[0], a.line, 'scale', 0.001), x: num(parts[1], a.line, 'x'), y: num(parts[2], a.line, 'y') };
        };
        emit(view(o.from, { scale: state.scale, x: state.x, y: state.y }), view(o.to, { scale: 1.1, x: 0, y: 0 }), a.at, dur, o.ease || 'linear');
      } else if (a.kind === 'spin') {
        emit({rotation:state.rotation}, {rotation:state.rotation + num(o.deg ?? 360, a.line, 'deg')}, a.at, dur, o.ease || 'inout', true);
      } else if (a.kind === 'wipe' || a.kind === 'drain') {
        const dir = choice(o.dir || 'r', ['l','r','u','d'], a.line, 'dir');
        const closed = {l:'inset(-50% -50% -50% 100%)', r:'inset(-50% 100% -50% -50%)', u:'inset(100% -50% -50% -50%)', d:'inset(-50% -50% 100% -50%)'}[dir];
        const open = 'inset(-50% -50% -50% -50%)';
        if (o.reverse) choice(o.reverse, ['on','off'], a.line, 'reverse');
        const reveal = a.kind === 'wipe' && o.reverse !== 'on';
        emit({clipPath:reveal ? closed : open}, {clipPath:reveal ? open : closed}, a.at, dur, o.ease || 'linear');
      } else if (a.kind === 'pop') {
        emit({scale:num(o.scale ?? 0, a.line, 'scale', 0), rotation:num(o.rotate ?? 0, a.line, 'rotate'), y:num(o.y ?? 0,a.line,'y'), opacity:0}, {scale:1, rotation:num(o['rest-rotate'] ?? 0,a.line,'rest-rotate'), y:0, opacity:basePose.opacity}, a.at, dur, o.ease || 'back');
      } else {
        const times = num(o.times ?? (a.kind === 'punch' ? 1 : 3), a.line, 'times', 1, 100);
        if (!Number.isInteger(times)) fail(a.line, 'times must be an integer');
        const from = {}, peak = {};
        if (a.kind === 'shake') {
          Object.assign(from, {x:state.x,y:state.y});
          Object.assign(peak, {x:state.x + num(o.x ?? 10,a.line,'x'),y:state.y + num(o.y ?? 0,a.line,'y')});
        } else {
          if (o.scale !== undefined || a.kind === 'punch') { from.scale=state.scale; peak.scale=num(o.scale ?? 1.12,a.line,'scale',0); }
          if (o.opacity !== undefined) { from.opacity=state.opacity; peak.opacity=num(o.opacity,a.line,'opacity',0,1); }
          if (!Object.keys(peak).length) {from.scale=state.scale;peak.scale=1.12;}
        }
        if (o.from !== undefined) {
          if (Object.keys(from).length !== 1) fail(a.line,'pulse from= needs exactly one animated property');
          const key = Object.keys(from)[0]; from[key] = num(o.from,a.line,'from',0,key==='opacity'?1:Infinity);
        }
        for (let i=0;i<times;i++) {
          emit(from,peak,a.at+i*dur/times,dur/times/2,o.ease || 'inout');
          emit(peak,from,a.at+(i+0.5)*dur/times,dur/times/2,o.ease || 'inout');
        }
      }
    }
    if (n.o.out && n.o.out !== 'none') {
      const d=Math.min(clock(n.o['out-dur'] ?? .4,n.line,'out-dur',.001),n.duration/3);
      emit({ ...state, clipPath: 'inset(-50% -50% -50% -50%)' }, animation(n.o.out), n.start-origin+n.duration-d-Math.min(1/m.fps,n.duration/8),d,n.o.ease);
    }
    return decorations.join('\n');
  }
  function visualTreatment(n) {
    const o=n.o;
    return `filter:${css(o.filter||'none')};transform-origin:${esc(o.origin||'50% 50%')};opacity:${num(o.opacity??1,n.line,'opacity',0,1)};border-radius:${radiusCss(o.radius,n.line)};border:${esc(css(o.border||'none'))};box-shadow:${esc(css(o.shadow||'none'))};overflow:${choice(o.clip||'off',['on','off'],n.line,'clip')==='on' && n.kind!=='text'?'hidden':'visible'}`;
  }
  function composition(n, content, kind = 'graphics', animatedInside = false) {
    for (const match of content.matchAll(/data-audio-group=["']([^"']+)["']/g)) usedBuses.add(match[1]);
    const file = `compositions/${n.id}.html`;
    fs.writeFileSync(path.join(dest, file), content);
    const decorations = animatedInside ? '' : animate(n, `#${n.id}-motion`, [0, 0, m.width, m.height]);
    const host = `<div${attrs({ id: n.id, class: 'clip', 'data-composition-id': n.id, 'data-composition-src': file, 'data-start': n.start - origin, 'data-duration': n.duration, 'data-width': m.width, 'data-height': m.height, 'data-track-index': n.o.track || 1, 'data-track-kind': kind, 'data-variable-values': n.o.vars, style: `position:absolute;inset:0;z-index:${n.o.layer ?? 1}` })}></div>`;
    return animatedInside ? host : `<div id="${n.id}-motion" style="position:absolute;inset:0;z-index:${n.o.layer ?? 1};${visualTreatment(n.kind==='captions'?{...n,o:{...n.o,radius:0,border:'none',shadow:'none'}}:n)}">${host}${decorations}</div>`;
  }
  function captions(n) {
    const file = resolveAsset(n.args[0],n.line); asset(n.args[0], n.line);
    let words; try { words = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(n.line, 'captions needs a JSON array of {word,start,end}'); }
    if (!Array.isArray(words) || !words.length) fail(n.line, 'captions needs a nonempty word array');
    let previousEnd = 0;
    for (const w of words) {
      if(w)w.word ??= w.text;
      if (!w || typeof w.word !== 'string' || !w.word.trim()) fail(n.line, 'each caption needs word, start and end');
      w.start=clock(w.start,n.line,'word start',0)-(String(w.start).startsWith('@')?n.start:0);
      w.end=clock(w.end,n.line,'word end',0)-(String(w.end).startsWith('@')?n.start:0);
      num(w.start,n.line,'word start',previousEnd);num(w.end,n.line,'word end',w.start+.001,n.duration);previousEnd=w.end;
    }
    const max = num(n.o['max-words'] ?? 4, n.line, 'max-words', 1, 20);
    if (!Number.isInteger(max)) fail(n.line, 'max-words must be an integer');
    const box = n.box;
    const groups = []; let group = [];
    for (let i = 0; i < words.length; i++) {
      group.push({ ...words[i], index: i });
      if (group.length >= max || /[.!?]$/.test(words[i].word) || !words[i + 1] || words[i + 1].start - words[i].end >= 0.15) { groups.push(group); group = []; }
    }
    const parentTweens=tweens,parentOrigin=origin;tweens=[];origin=n.start;
    const markup=groups.map((g,i)=>{
      const o={...n.o,opacity:1,filter:'none'};for(const key of ['in','out','words','style','drift','until'])delete o[key];
      o.track=Number(n.o.track)+i;o.align ??= 'center';o.color ??= '#ffffff';
      const child={kind:'text',id:`${n.id}-group-${i}`,line:n.line,args:[g.map(w=>w.word).join(' ')],o,children:[],start:n.start+g[0].start,duration:g.at(-1).end-g[0].start,box:[box[0]+box[2]*.06,box[1]+box[3]*.06,box[2]*.88,box[3]*.88],animations:[{kind:'karaoke',line:n.line,o:{at:g.map(w=>w.start-g[0].start).join(','),dur:.04,color:n.o.highlight||'#ffe600'}}]};
      return render(child);
    }).join('\n');
    const content=`<template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${n.id}" data-duration="${n.duration}" data-width="${m.width}" data-height="${m.height}">${markup}</div><script>const tl=gsap.timeline({paused:true});${TEXT_FIT}${tweens.join('\n')}window.__timelines[${js(n.id)}]=tl;</script></template>`;
    tweens=parentTweens;origin=parentOrigin;
    return composition(n,content,'captions');
  }

  function fontFamily(value, line) {
    if (!/\.(?:woff2?|ttf|otf)$/i.test(value)) return css(value);
    const ref = asset(value, line), family = `orb-font-${fonts.size}`;
    if (!fonts.has(ref)) fonts.set(ref, family);
    return `"${fonts.get(ref)}"`;
  }
  function richText(source,n) {
    let result='', cursor=0; const stack=[];
    // A small allowlist, never arbitrary HTML, attributes, CSS or script.
    const re=/<br\s*\/?>|<\/?(?:b|small)>|\[img\s+[^\]]+\]|\*([^*]+)\*(?:\{([^{}]*)\})?/g;
    for(const m of source.matchAll(re)) {
      result+=esc(source.slice(cursor,m.index));cursor=m.index+m[0].length;
      if(m[0].startsWith('<br')) result+='<br>';
      else if(m[0].startsWith('<')) {
        const close=m[0][1]==='/', tag=m[0].replace(/[<>/]/g,'');
        if(close && stack.pop()!==tag) fail(n.line,`unbalanced inline ${tag}`);
        if(!close) stack.push(tag);
        const size=tag==='b'?n.o['bold-size']:n.o['small-size'];
        result+=close ? `</${tag}>` : `<${tag} style="${size?`font-size:${num(size,n.line,'inline size',1)}px;`:''}${tag==='small'&&n.o['small-color']?`color:${esc(n.o['small-color'])};`:''}">`;
      } else if(m[0].startsWith('[img')) {
        const {args,named:o}=tokens(m[0].slice(4,-1).trim(),n.line);
        if(args.length!==1) fail(n.line,'inline image needs one path');
        for(const key of Object.keys(o)) choice(key,['size','bg','radius','pad','align','gap'],n.line,'inline image option');
        result+=`<span style="display:inline-flex;width:${esc(o.size||'1.1em')};height:${esc(o.size||'1.1em')};background:${esc(o.bg||'transparent')};border-radius:${esc(o.radius||'0')};align-items:center;justify-content:center;vertical-align:${esc(o.align||'-.2em')};margin-right:${esc(o.gap||'.35em')}"><img src="${esc(asset(args[0],n.line))}" style="width:${esc(o.pad?`calc(100% - ${o.pad} * 2)`:'100%')};height:${esc(o.pad?`calc(100% - ${o.pad} * 2)`:'100%')};object-fit:contain"></span>`;
      } else {
        const {args,named:o}=tokens(m[2]||'',n.line);
        if(args.length) fail(n.line,'inline span needs option=value');
        for(const key of Object.keys(o)) choice(key,['color','size','weight','bg','radius','pad','width','gap','align'],n.line,'inline span option');
        const style=Object.entries(o).map(([k,v])=>`${({size:'font-size',weight:'font-weight',bg:'background',radius:'border-radius',pad:'padding',gap:'margin-right',align:'text-align'})[k]||k}:${['size','radius','pad','width','gap'].includes(k)?num(v,n.line,k,0)+'px':esc(v)}`).join(';');
        result+=`<span style="${(o.width?'display:inline-block;':'')+style||`color:${esc(n.o.emph||'#ffe600')}`}">${richText(m[1],n)}</span>`;
      }
    }
    if(stack.length) fail(n.line,`unclosed inline ${stack.at(-1)}`);
    return result+esc(source.slice(cursor));
  }
  function textContent(n) {
    if(/<\/?(?:br|b|small)\b|\[img\s|\*[^*]*\*\{/.test(n.args[0])) {
      if(n.o.words || n.animations.some(a=>['karaoke','type'].includes(a.kind))) fail(n.line,'rich text cannot combine with word highlights or type');
      let gap='';
      return richText(String(binding(n.args[0],'text').value),n).split(/(<[^>]+>)/).map(part=>{
        if(part.startsWith('<')) {if(part==='<br>')gap='';return part;}
        return part.split(/(\s+)/).map(w=>{if(!w)return '';if(/^\s+$/.test(w)){gap+=w;return '';}const text=gap+w;gap='';return `<span style="white-space:pre-wrap">${text}</span>`;}).join('');
      }).join('');
    }
    let word = 0, hot = false, pendingSpace = '';
    const timedWords = n.o.words || n.animations.some(a => a.kind === 'karaoke');
    n.wordColors = [];
    let text = n.args[0].split(/(\*)/).map(part => {
      if (part === '*') { hot = !hot; return ''; }
      const ink = hot ? n.o.emph || '#ffe600' : (n.o.color==='auto'?'inherit':n.o.color) || '#ffffff';
      if (!n.args[0].includes('{$')) return part.split(/(\s+)/).map(w => {
        if (!w) return '';
        if (/^\s+$/.test(w)) { pendingSpace += w; return ''; }
        // HF's template flattener drops whitespace-only DOM nodes. Keep actual
        // whitespace inside a visible word span so it survives mounting.
        const gap = pendingSpace; pendingSpace = '';
        n.wordColors.push(ink);
        return `<span id="${n.id}-word-${word++}" style="display:inline-block;white-space:pre;margin:0 ${esc(n.o['word-pad'] || '0')};color:${esc(ink)}">${esc(gap+w)}</span>`;
      }).join('');
      const value = part.split(/(\{\$[\w-]+\})/g).map(p => {const b=binding(p,'text');return b.attr['data-var-text'] ? `<span${attrs(b.attr)}>${esc(b.value)}</span>` : esc(p);}).join('');
      return hot ? `<span style="color:${esc(ink)}">${value}</span>` : value;
    }).join('');
    if (pendingSpace && word) text = text.replace(/<\/span>$/,esc(pendingSpace)+'</span>');
    if (hot) fail(n.line, 'unclosed inline emphasis');
    n.wordCount = word;
    if (n.animations.some(a=>a.kind === 'type')) {
      if (timedWords || n.args[0].includes('*') || n.args[0].includes('{$')) fail(n.line, 'type cannot combine with word highlights, emphasis or text bindings');
      const types = n.animations.filter(a=>a.kind === 'type');
      if (types.length !== 1 || String(types[0].o.at ?? 0).includes(',')) fail(n.line,'type needs one start per text item');
      const chars = Array.from(n.args[0]); n.charCount = chars.length;
      const cursor = n.animations.find(a=>a.kind === 'type').o.cursor;
      return chars.map((c,i)=>`<span id="${n.id}-char-${i}" style="display:none">${esc(c)}</span>`).join('') + (cursor ? `<span id="${n.id}-cursor" style="display:inline-block;width:.55em;height:1em;margin-left:.12em;vertical-align:-.14em;background:${esc(css(cursor))}"></span>` : '');
    }
    return text;
  }
  function render(n, parentBox = [0, 0, m.width, m.height]) {
    const o = n.o, box = n.box || [0, 0, parentBox[2], parentBox[3]];
    const [x, y, w, h] = box;
    const style = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${num(o.layer ?? 1, n.line, 'layer')}`;
    const treatment = visualTreatment(n);
    const timed = { id: n.id, class: 'clip', 'data-start': n.start - origin, 'data-duration': n.duration, 'data-track-index': num(o.track ?? 1, n.line, 'track', 0), 'data-track-kind': 'graphics', style };
    if (o.overlap !== undefined) { choice(o.overlap, ['allow'], n.line, 'overlap'); timed['data-layout-allow-overlap'] = ''; timed['data-layout-allow-occlusion'] = ''; }   // intentional layering
    if (n.kind === 'captions') return captions(n);
    if (n.kind === 'comp') {
      const html = importComposition(n.args[0], n.id, n.line);
      return composition(n, html);
    }
    if (n.kind === 'html') {
      let html = rewrite(n.raw, n.line);
      if (!/id=["']root["']/.test(html)) html = `<style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${n.id}" data-duration="${n.duration}" data-width="${m.width}" data-height="${m.height}">${html}</div>`;
      html = normalize(html, n.id, n.line);
      return composition(n, html);
    }
    if (n.kind === 'audio') {
      const b = binding(n.args[0], 'src'), fade = o.fade ? tuple(o.fade, n.line, 'fade', 2) : [];
      usedBuses.add(o.bus || 'voice');
      busAudio[o.bus || 'voice'].push(`<audio${attrs({ ...timed, 'data-start': n.start, style: undefined, 'data-track-kind': undefined, src: asset(String(b.value), n.line), ...b.attr, 'data-audio-group': o.bus || 'voice', 'data-volume': o.volume ?? 1, 'data-media-start': o.trim ?? 0, 'data-fade-in': fade[0], 'data-fade-out': fade[1] })}></audio>`);
      if (n.animations.length || o.in || o.out) fail(n.line, 'audio uses fade= for gain; visual animation needs a visual item');
      return '';
    }
    if (n.kind === 'group') {
      const parentTweens = tweens, parentOrigin = origin;
      tweens = []; origin = n.start;
      const decorations = animate(n, `#${n.id}-motion`, box);
      if (o.clip) choice(o.clip, ['on', 'off'], n.line, 'clip');
      const groupStyle = `${style};${treatment};background:${esc(css(o.bg||'transparent'))};overflow:${o.clip === 'on' ? 'hidden' : 'visible'};border:${esc(o.border || 'none')};border-radius:${radiusCss(o.radius,n.line)};box-shadow:${esc(o.shadow || 'none')}`;
      const children = n.children.map(c => render(c, box)).join('\n');
      const content = `<template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${n.id}" data-duration="${n.duration}" data-width="${m.width}" data-height="${m.height}"><div id="${n.id}-motion" style="${groupStyle}">${children}${decorations}</div></div><script>const tl=gsap.timeline({paused:true});${STATE_AT}${FORMAT_NUMBER}${TEXT_FIT}${tweens.join('\n')}tl.seek(0,true);window.__timelines[${js(n.id)}]=tl;</script></template>`;
      tweens = parentTweens; origin = parentOrigin;
      return composition(n, content, 'graphics', true);
    }
    if (['video', 'image'].includes(n.kind)) {
      const b = binding(n.args[0], 'src');
      const position=o.pos || '50%,50%';
      if(position.split(',').length!==2 || position.split(',').some(v=>!/^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/.test(v))) fail(n.line,'pos needs x%,y%');
      const media = { ...timed, style: `position:absolute;inset:0;width:100%;height:100%;object-fit:${o.fit || 'contain'};object-position:${position.replace(',',' ')};border-radius:${radiusCss(o.radius,n.line)};background:${esc(o.bg||'transparent')}`, src: asset(String(b.value), n.line), ...b.attr, 'data-track-kind': undefined };
      if (n.kind === 'video') Object.assign(media, { 'data-media-start': o.trim ?? 0, 'data-playback-rate': o.rate ?? 1, 'data-volume': o.volume ?? 1, ...(o.sound === 'on' ? { 'data-has-audio': 'true' } : { muted: '' }), playsinline: '' });
      let cropStyle = '';
      if (o.crop) {
        const [cx,cy,cw,ch] = tuple(o.crop,n.line,'crop');
        if (cx < 0 || cy < 0 || cx+cw > 1+1e-6 || cy+ch > 1+1e-6) fail(n.line,'crop uses normalized x,y,w,h inside 0..1');
        media.style = `position:absolute;left:${-cx/cw*100}%;top:${-cy/ch*100}%;width:${100/cw}%;height:${100/ch}%;object-fit:${o.fit || 'fill'}`;
        cropStyle = 'overflow:hidden;';
      }
      const decorations = animate(n, `#${n.id}-motion`, box);
      if(n.kind==='video' && o.loop==='on') {
        let length;
        if(o.length!==undefined) length=clock(o.length,n.line,'length',.001);
        else {
          const {spawnSync}=require('child_process');
          const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',resolveAsset(String(b.value),n.line)],{encoding:'utf8'});
          if(probe.status || !Number.isFinite(Number(probe.stdout.trim()))) fail(n.line,'loop needs a readable video duration or length=seconds');
          length=num(probe.stdout.trim(),n.line,'video duration',.001);
        }
        let trim=Number(o.trim||0),elapsed=0,k=0;const clips=[];
        if(trim>=length) fail(n.line,'loop trim must be less than source length');
        while(elapsed<n.duration-1e-8) {
          if(k>=10000) fail(n.line,'loop exceeds 10000 segments');
          const duration=Math.min((length-trim)/Number(o.rate||1),n.duration-elapsed);
          const id=k?`${n.id}-loop-${k}`:n.id;
          if(k && renderIds.has(id)) fail(n.line,`loop segment id '${id}' conflicts with an authored id`);
          renderIds.add(id);
          clips.push(`<video${attrs({...media,id,'data-start':n.start-origin+elapsed,'data-duration':duration,'data-media-start':trim,'data-track-index':Number(o.track)+k%2})}></video>`);
          elapsed+=duration;trim=0;k++;
        }
        return `<div id="${n.id}-motion" style="${style};${treatment};${cropStyle}">${clips.join('\n')}${decorations}</div>`;
      }
      return `<div id="${n.id}-motion" style="${style};${treatment};${cropStyle}"><${n.kind === 'video' ? 'video' : 'img'}${attrs(media)}>${n.kind === 'video' ? '</video>' : ''}${decorations}</div>`;
    }
    const preparedText = n.kind === 'text' ? textContent(n) : '';
    const decorations = animate(n, `#${n.id}-motion`, box);
    if(n.kind==='text' && o.color==='auto') tweens.push(`tl.fromTo(Object.defineProperty({},'v',{set:()=>updateOrbColor(document.getElementById(${js(n.id+'-motion')}))}),{v:0},{v:1,duration:${n.duration},ease:'none',immediateRender:true},${n.start-origin});`);
    let contentStyle = `width:${o.width===undefined?'100%':choice(o.width,['auto','fill'],n.line,'width')==='auto'?'max-content':'100%'};height:${choice(o.height || 'fill',['auto','fill'],n.line,'height') === 'auto' ? 'auto' : '100%'};${treatment};${n.kind==='text'?'overflow:visible;':''}box-sizing:${choice(o.sizing||'border',['border','content'],n.line,'sizing')}-box;`; let text = '', bind = {};
    if (n.kind === 'text') {
      text = preparedText;
      contentStyle += `font-family:${fontFamily(o.font || 'Inter', n.line)};font-size:${numericCss(o.size ?? 64, n.line, 'size', 1, Infinity, true)};font-weight:${numericCss(o.weight ?? 700, n.line, 'weight', 1, 1000)};color:${css(o.color==='auto'?'#ffffff':o.color || '#ffffff')};text-align:${choice(o.align || 'left', ['left', 'center', 'right'], n.line, 'align')};background:${css(o.bg || 'transparent')};padding:${String(o.pad ?? 0).split(/[,\s]+/).map(v=>numericCss(v,n.line,'pad',0,Infinity,true)).join(' ')};box-shadow:${css(o['box-shadow'] || 'none')};white-space:${choice(o.whitespace || 'pre-wrap',['pre-wrap','normal','nowrap','pre'],n.line,'whitespace')};line-height:${o.leading || 'normal'};letter-spacing:${o.spacing || 'normal'};-webkit-text-stroke:${css(o.stroke || '0 transparent')};paint-order:stroke fill;text-shadow:${css(o.shadow || 'none')};border:${css(o.border || 'none')};border-left:${css(o['border-left'] || o.border || 'none')};`;
      if (o.fill) contentStyle += `color:transparent;background:${css(o.fill)};-webkit-background-clip:text;background-clip:text;`;
      if (o.words) {
        const wordsFile=resolveAsset(o.words,n.line);
        let words; try { words = JSON.parse(fs.readFileSync(wordsFile,'utf8')); } catch { fail(n.line,'words needs a JSON array of {word,start,end}'); }
        if (!Array.isArray(words) || words.some(w => !w || typeof w.word !== 'string') || words.map(w=>w.word).join(' ') !== n.args[0].replace(/\*/g,'').trim().replace(/\s+/g,' ')) fail(n.line,'words JSON must match text');
        wordHighlights(n, words, o.emph || '#ffe600'); asset(o.words,n.line);
      }
    } else contentStyle += `background:${css(o.bg || (o.color==='auto'?'#ffffff':o.color) || '#ffffff')};border:${css(o.border || 'none')};box-shadow:${css(o.shadow || 'none')};`;
    contentStyle += `border-radius:${String(o.radius ?? 0).split(/[,\s]+/).map(v=>numericCss(v,n.line,'radius',0,Infinity,true)).join(' ')};`;
    return `<div${attrs(timed)}><div${attrs({ id: `${n.id}-motion`, 'data-orb-fit': n.kind==='text' && choice(o.fit||'on',['on','off'],n.line,'fit')!=='off' ? Number(binding(o.size??64,'size').value)||64 : undefined,  'data-orb-auto': n.kind==='text' && o.color==='auto'?'true':undefined, style: contentStyle })}>${n.kind === 'text' ? `<span${attrs({ ...bind, id: `${n.id}-value` })}>${text}</span>` : ''}${decorations}</div></div>`;
  }
  const declaredFonts=m.fonts.map(f=>({ref:asset(f.file,f.line),family:f.name}));
  const body = m.children.map(n => render(n)).join('\n');
  const fontCss = [...declaredFonts,...[...fonts].map(([ref,family])=>({ref,family}))].map(({ref,family}) => `@font-face{font-family:"${family}";src:url("${ref}");font-weight:100 1000;font-display:block}`).join('');
  for (const file of fs.readdirSync(path.join(dest,'compositions'))) {
    const loc=path.join(dest,'compositions',file);
    fs.writeFileSync(loc,fs.readFileSync(loc,'utf8').replace('<template>',`<template><style>${fontCss}</style>`));
  }
  const buses = Object.entries(m.buses).filter(([id]) => usedBuses.has(id)).map(([id, volume]) => `<hf-audio-group id="${id}" data-volume="${volume}" data-label="${id}"></hf-audio-group>${busAudio[id].join('\n')}`).join('\n');
  const vars = m.variables.map(v => `--${v.id}:${String(v.default).replace(/[;<>]/g, '')}`).join(';');
  const html = `<!doctype html>\n<html lang="en"${attrs({ 'data-composition-variables': JSON.stringify(m.variables) })}><head><meta charset="UTF-8"><meta name="viewport" content="width=${m.width},height=${m.height}"><title>${esc(m.title)}</title><script src="${GSAP}"></script><style>${fontCss}*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%;background:#0b0f1a}#root{position:relative;width:100%;height:100%;overflow:hidden;${esc(vars)}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${m.duration}" data-width="${m.width}" data-height="${m.height}" data-fps="${m.fps}">${body}\n${buses}</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});\n${STATE_AT}\n${FORMAT_NUMBER}\n${TEXT_FIT}\n${tweens.join('\n')}\ntl.seek(0,true);window.__timelines["main"]=tl;</script></body></html>\n`;
  fs.writeFileSync(path.join(dest, 'index.html'), html);
  const sourceMap={ids:{},items:[],source:options.sourceFile||null};
  function mapNodes(nodes,offset=[0,0]){for(const n of nodes){
    sourceMap.ids[n.id]=n.line;sourceMap.ids[n.id+'-motion']=n.line;
    sourceMap.items.push({id:n.id,line:n.line,text:n.args[0]||'',start:n.start,end:n.start+n.duration,box:[offset[0]+n.box[0],offset[1]+n.box[1],n.box[2],n.box[3]]});
    mapNodes(n.children,[offset[0]+n.box[0],offset[1]+n.box[1]]);
  }}
  mapNodes(m.children);
  fs.writeFileSync(path.join(dest,'orb-map.json'),JSON.stringify(sourceMap,null,2)+'\n');
  fs.writeFileSync(path.join(dest, 'hyperframes.json'), JSON.stringify({ name: m.title }, null, 2) + '\n');
  return m;
}
function cli(args,command='build') {
  const file=args[0],rest=args.slice(1);let out,sheet=false;
  for(let i=0;i<rest.length;i++) {
    if(rest[i]==='-o' && rest[i+1])out=rest[++i];
    else if(rest[i]==='--sheet')sheet=true;
    else throw new Error(`unknown argument '${rest[i]}'`);
  }
  if(!file || (command==='build' && !out))throw new Error(`usage: orb ${command} file.orb ${command==='build'?'-o outdir':'[-o outdir]'} [--sheet]`);
  out ||= path.join('out/hf',`check-${path.basename(file,'.orb')}`);
  const absolute=path.resolve(file);
  const motion=build(fs.readFileSync(absolute,'utf8'),out,{baseDir:path.dirname(absolute),sourceFile:absolute,onWarning:message=>console.error(message)});
  console.log(`wrote ${path.resolve(out)} (${motion.width}x${motion.height}, ${motion.duration}s, ${motion.fps}fps)`);
  const {checkProject,contactSheet}=require('./hf-check');
  const result=checkProject(out);
  if(sheet)console.log(`wrote ${contactSheet(out,motion)} (1 fps)`);
  if(!result.ok)throw new Error(`HyperFrames check failed (${result.errors} errors; see ${path.join(out,'orb-check.json')})`);
  console.log('HyperFrames check passed');
}
module.exports = { parse, build, cli, HFError, expandSource: expanded };
