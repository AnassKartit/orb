const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse, build } = require('../src/hf');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-hf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const baseDir = path.join(root, 'source'), out = path.join(root, 'out');
  fs.mkdirSync(baseDir); return { baseDir, out };
}
test('presets, fps, sibling timing and group-local clocks', () => {
  for (const [preset, size] of Object.entries({ '16:9': [1920,1080], '9:16': [1080,1920], '1:1': [1080,1080], '4:5': [1080,1350] })) {
    const m = parse(`motion "Test" ${preset} 10s fps=24\n  rect dur=2\n  rect at=+0.3 dur=1\n  group id=g at=< dur=3\n    text "Nested" at=0.5 dur=1\n`);
    assert.deepEqual([m.width,m.height], size); assert.equal(m.fps,24);
    assert.deepEqual(m.children.map(n => n.start), [0,2.3,2.3]);
    assert.equal(m.children[2].children[0].start,2.8);
  }
});
test('existing let/def/repeat/if preserve bindings, JSON, raw HTML and source lines', () => {
  const source = `let copies = 2\ndef card(label)\n  text "{label}" dur=1\nmotion "Test" 4s\n  var headline string "Hi # all"\n  repeat copies as i\n    if i > 0\n      card "Card {i}"\n  comp "card.html" at=0 dur=2 vars={"a": {"b": "Hello world"}}\n  text "{$headline}" at=0 dur=1\n  html at=0 dur=1\n    <style>#root { color: #fff; }</style>\n\n    <p data-json='{"a": 1}'>raw</p>\n`;
  const m = parse(source);
  assert.deepEqual(m.children.slice(0,2).map(n => n.args[0]), ['Card 1','Card 2']);
  assert.equal(m.children[2].o.vars, '{"a": {"b": "Hello world"}}');
  assert.equal(m.variables[0].default,'Hi # all');
  assert.match(m.children[4].raw, /#root \{ color: #fff; \}/);
  assert.match(m.children[4].raw, /\n\n/);
  assert.throws(() => parse('motion "Test" 2s\n  tect "Hi"'), /line 2: unknown word 'tect'; did you mean 'text'/);
});
test('reject phase-2 grammar and invalid numbers, nesting, assets and durations', t => {
  for (const kind of ['scene','use','svg','speed']) assert.throws(() => parse(`motion "T" 2s\n  ${kind} 2s`), /outside Phase 1/);
  for (const line of ['rect dur=wat','rect dur=-1','rect box=1,2,0,4','video "x" rate=12','text "x" bogus=1','rect at=2 dur=1']) assert.throws(() => parse(`motion "T" 2s\n  ${line}`), /line 2/);
  assert.throws(() => parse('motion "T" 2s\n  text "x"\n    rect'), /only group/);
  const f = fixture(t);
  assert.throws(() => build('motion "T" 2s\n  image "missing.png"', f.out, f), /line 2: asset/);
  assert.throws(() => build('motion "T" 2s\n  rect\n    zoom at=1 dur=1 box=0,0,100,100 hold=1', f.out, f), /line 3: animation must fit/);
});
test('assets with colliding basenames copy separately; bus routes and numeric/text variables survive', t => {
  const f = fixture(t);
  for (const dir of ['a','b']) { fs.mkdirSync(path.join(f.baseDir,dir)); fs.writeFileSync(path.join(f.baseDir,dir,'x.png'),dir); }
  const source = `motion "T" 4s\n  var name string "Orb"\n  var size number "44"\n  var ink color "#ffffff"\n  image "a/x.png" dur=1\n  image "b/x.png" dur=1\n  audio "a/x.png" id=voice-clip at=0 dur=2 bus=voice\n  text "Hello {$name}" at=0 dur=4 size={$size} color={$ink}\n`;
  build(source,f.out,f);
  const html = fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.equal(fs.readdirSync(path.join(f.out,'assets')).length,2);
  assert.match(html,/data-audio-group="voice"/); assert.match(html,/<hf-audio-group[^>]+><\/hf-audio-group><audio/);
  assert.match(html,/Hello <span data-var-text="name">Orb<\/span>/);
  assert.match(html,/font-size:calc\(var\(--size\) \* 1px\)/);
  assert.match(html,/color:var\(--ink\)/);
  build(source,f.out,f); assert.equal(fs.readFileSync(path.join(f.out,'index.html'),'utf8'),html);
});
test('group is an independently seekable template, with one timed video and local animation clock', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.baseDir,'clip.mp4'),'fixture');
  build('motion "T" 8s\n  group id=g at=3 dur=4\n    video "clip.mp4" at=0.5 dur=2\n    to at=1 dur=1 x=100\n', f.out, f);
  const html = fs.readFileSync(path.join(f.out,'compositions/g.html'),'utf8');
  assert.match(html,/<template>/); assert.match(html,/data-start="0.5"/);
  assert.match(html,/window.__timelines\["g"\]=tl/); assert.match(html,/"duration":1.*},1\)/);
  assert.doesNotMatch(html, /class="clip"[^>]*>[\s\S]*<video/);
});
test('captions reject unordered timestamps and put every group on one captions composition', t => {
  const f = fixture(t), file = path.join(f.baseDir,'words.json');
  fs.writeFileSync(file,JSON.stringify([{word:'Hello',start:.2,end:.5},{word:'Orb',start:.6,end:1}]));
  build('motion "T" 2s\n  captions "words.json" dur=2 max-words=2',f.out,f);
  assert.match(fs.readFileSync(path.join(f.out,'index.html'),'utf8'),/data-track-kind="captions"/);
  const html = fs.readFileSync(path.join(f.out,'compositions/captions-1.html'),'utf8');
  assert.equal((html.match(/class="clip"/g)||[]).length,1);
  fs.writeFileSync(file,JSON.stringify([{word:'Bad',start:1,end:.5}]));
  assert.throws(() => build('motion "T" 2s\n  captions "words.json"',f.out,f), /word end/);
});
test('HTML animation children and explicit root ids mount under the authored id', t => {
  const f = fixture(t);
  build('motion "T" 3s\n  html id=custom dur=3\n    <style>#root{position:absolute;inset:0}</style>\n    <div id="root" data-composition-id="old"><p>Literal</p></div>\n    to at=0.5 dur=0.5 x=30\n',f.out,f);
  const scene = fs.readFileSync(path.join(f.out,'compositions/custom.html'),'utf8');
  assert.match(scene,/data-composition-id="custom"/); assert.match(scene,/__timelines\["custom"\]/);
  assert.doesNotMatch(scene,/to at=/);
  assert.match(fs.readFileSync(path.join(f.out,'index.html'),'utf8'),/#custom-motion/);
});
test('imported compositions copy nested compositions, fonts and assets, and reject import cycles', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.baseDir,'compositions')); fs.mkdirSync(path.join(f.baseDir,'assets'));
  fs.writeFileSync(path.join(f.baseDir,'assets','font.woff2'),'fixture');
  fs.writeFileSync(path.join(f.baseDir,'compositions','child.html'),'<template><style>#root{position:absolute;inset:0}@font-face{font-family:Custom;src:url("assets/font.woff2")}</style><div id="root" data-composition-id="child"></div></template>');
  fs.writeFileSync(path.join(f.baseDir,'compositions','parent.html'),'<template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="parent"><div id="child" data-composition-id="child" data-composition-src="compositions/child.html" data-start="0" data-duration="2"></div></div></template>');
  build('motion "T" 2s\n  comp "compositions/parent.html" id=mounted dur=2',f.out,f);
  const child = fs.readFileSync(path.join(f.out,'compositions/child.html'),'utf8');
  assert.match(child,/url\("assets\/[\w-]+\.woff2"\)/);
  assert.match(child,/__timelines\["child"\].*<\/script><\/template>/);
  fs.writeFileSync(path.join(f.baseDir,'compositions','child.html'),'<template><div id="root" data-composition-id="child"><div data-composition-id="parent" data-composition-src="compositions/parent.html"></div></div></template>');
  assert.throws(() => build('motion "T" 2s\n  comp "compositions/parent.html"',f.out,f),/import cycle/);
});

// Evaluate the generated script with a recording timeline. This exercises the emitted
// JavaScript (including number setters) without network access or a browser install.
function compiled(t, body, options = '') {
  const f = fixture(t);
  build(`motion "Verbs" 1080x600 5s ${options}\n${body}`, f.out, f);
  return { ...f, html: fs.readFileSync(path.join(f.out,'index.html'),'utf8') };
}
function scriptTweens(html) {
  const vm = require('vm'), calls = [], values = {};
  const tl = { fromTo(target, from, to, at) { calls.push({target,from,to,at}); return tl; }, seek() {}, time() {return 0;} };
  const context = { window: {__timelines:{}}, document: {getElementById(id) {return values[id] ||= {}; }}, gsap: {timeline() {return tl;},getProperty() {return 0;}} };
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(match[1], context);
  return {calls,values};
}
for (const [verb, opts, count, property, end] of [
  ['shake','x=12 y=-6 times=3',6,'x',0],
  ['pulse','scale=1.4 opacity=0.2 times=2',4,'scale',1],
  ['punch','scale=1.4',2,'scale',1],
  ['push','from=1,0,0 to=1.5,40,-20',1,'scale',1.5],
  ['spin','deg=90',1,'rotation',90],
  ['wipe','dir=l',1,'clipPath','inset(-50% -50% -50% -50%)'],
  ['pop','rotate=-12 scale=0',1,'scale',1],
  ['drain','dir=d',1,'clipPath','inset(-50% -50% 100% -50%)'],
]) test(`${verb}: repeated times emit bounded fromTo motion and finish at the intended state`, t => {
  const {html} = compiled(t,`  rect\n    ${verb} at=0.5,2.5 dur=1 ${opts}\n`);
  const {calls} = scriptTweens(html);
  assert.equal(calls.length, count*2);
  assert.equal(calls[count-1].to[property], end);
  assert.equal(calls.at(-1).to[property], verb === 'spin' ? end*2 : end);
  assert.equal(calls[0].at,0.5); assert.equal(calls[count].at,2.5);
  for (const c of calls) { assert.ok(c.to.duration>0); assert.ok(c.at+c.to.duration<=3.5+1e-6); }
});
test('flash creates separate zero-opacity overlays and one tween per requested time', t => {
  const {html} = compiled(t,'  rect\n    flash at=1,2,3 color=#ff0000 opacity=0.4 dur=0.2\n');
  const {calls} = scriptTweens(html);
  assert.equal(calls.length,3); assert.equal(new Set(calls.map(c=>c.target)).size,3);
  assert.deepEqual(calls.map(c=>c.at),[1,2,3]);
  for (const c of calls) {assert.equal(c.from.opacity,.4);assert.equal(c.to.opacity,0);assert.equal(c.to.immediateRender,false);}
  assert.match(html,/background:#ff0000;opacity:0/);
});
test('count formatting executes on property writes even when GSAP events are suppressed', t => {
  for (const [format, value, expected] of [['N {n:,}',1234,'N 1,234'],['{n:04}',42,'0042'],['USD {n:.2f}',12.345,'USD 12.35'],['{}%',99,'99%']]) {
    const {html} = compiled(t,`  text "0"\n    count from=0 to=2000 at=0 dur=4 format="${format}"\n`);
    const {calls,values} = scriptTweens(html), c = calls[0];
    assert.equal(c.from.v,0); assert.equal(c.to.v,2000);
    c.target.v=value; assert.equal(values['text-1-value'].textContent,expected);
    c.target.v=0; c.target.v=value; assert.equal(values['text-1-value'].textContent,expected);
    assert.equal(c.to.onUpdate,undefined);
  }
});
test('to, zoom and highlight accept multi-time starts, also under nested local clocks', t => {
  const f=fixture(t);
  build('motion "M" 10s\n  group id=g at=2 dur=7\n    rect id=r at=1 dur=6\n      to at=0,2 dur=0.3 x=10\n      zoom at=0.5,3 dur=0.2 hold=0.1 box=0,0,400,200\n      highlight at=1,4 dur=0.5 box=0,0,400,200\n', f.out,f);
  const {calls}=scriptTweens(fs.readFileSync(path.join(f.out,'compositions/g.html'),'utf8'));
  assert.equal(calls.length,8);assert.deepEqual(calls.filter(c=>c.to.x===10 && c.to.duration===0.3).map(c=>c.at),[1,3]);
});
test('emphasis is escaped, and karaoke timings highlight precisely one span per word', t => {
  const {html} = compiled(t,'  text "WAIT *999* <&>" emph=#FFE600\n    karaoke at=0,1,2 color=#00ffff\n');
  assert.match(html,/color:#FFE600.*999/);assert.match(html,/&lt;&amp;&gt;/);
  const {calls}=scriptTweens(html);
  assert.deepEqual(calls.filter(c=>c.to.color==='#00ffff').map(c=>c.at),[0,1,2]);
  assert.equal(calls.length,5);
  assert.equal(calls[0].to.duration,.08);assert.equal(calls[0].to.ease,'power1.out');
});
test('words JSON, assets root, local fonts, automatic lanes and def instances work together', t => {
  const f=fixture(t);fs.mkdirSync(path.join(f.baseDir,'media'));
  fs.writeFileSync(path.join(f.baseDir,'media','face.woff2'),'fixture');
  fs.writeFileSync(path.join(f.baseDir,'media','words.json'),JSON.stringify([{word:'Hello',start:0,end:.5},{word:'Orb',start:.5,end:1}]));
  const src='def plate(copy, at)\n  group at={at} dur=2 box=10,20,500,200\n    text "{copy}" at=0 box=5,8,400,100 font=face.woff2 words=words.json\nmotion "M" 5s assets=media\n  plate "Hello Orb" 0\n  plate "Hello Orb" 2\n';
  build(src,f.out,f);
  const m=parse(src);assert.notEqual(m.children[0].id,m.children[1].id);assert.notEqual(m.children[0].o.track,m.children[1].o.track);
  const scene=fs.readFileSync(path.join(f.out,'compositions/group-1.html'),'utf8');
  assert.match(scene,/@font-face/);assert.match(scene,/data-orb-fit="64"/);assert.equal(m.children[0].children[0].o.box,'5,8,400,100');assert.match(scene,/width:500px;height:200px/);
  assert.equal(scriptTweens(scene).calls.length,3);
});
test('normalized video crop is a clipped viewport, with only one timed media element', t => {
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'clip.mp4'),'fixture');
  build('motion "M" 2s\n  video "clip.mp4" crop=0.25,0.1,0.5,0.8\n',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.match(html,/overflow:hidden/);assert.match(html,/left:-50%;top:-12.5%;width:200%;height:125%/);
  assert.equal((html.match(/class="clip"/g)||[]).length,1);
  assert.throws(()=>build('motion "M" 2s\n  video "clip.mp4" crop=0.8,0,0.5,1',f.out,f),/crop uses normalized/);
});
test('verbs reject malformed times, unsafe extents, invalid directions and text misuse with source lines', t => {
  for(const child of ['shake at=0 dur=1 times=1.5','push from=1,2 at=0 dur=1','wipe dir=z at=0 dur=1','pulse opacity=2 at=0 dur=1','spin at=0,4.9 dur=1','to at=0,wat x=1','karaoke at=0,1']) {
    const f=fixture(t);assert.throws(()=>build(`motion "M" 5s\n  rect\n    ${child}`,f.out,f),/line 3/);
  }
  const f=fixture(t);
  assert.throws(()=>build('motion "M" 5s\n  text "A B"\n    karaoke at=1,0',f.out,f),/word end|word times/);
  assert.throws(()=>build('motion "M" 5s\n  text "0"\n    count format=oops',f.out,f),/format needs/);
});
test('absolute karaoke times inside a delayed group use the global clock', t => {
  const f=fixture(t);
  build('motion "M" 8s\n  group id=g at=2 dur=5\n    text "A B" at=1 dur=3\n      karaoke abs=on at=3,4 color=#ffe600\n',f.out,f);
  const {calls}=scriptTweens(fs.readFileSync(path.join(f.out,'compositions/g.html'),'utf8'));
  assert.deepEqual(calls.filter(c=>c.to.color==='#ffe600').map(c=>c.at),[1,2]);
});

test('word spans retain real whitespace after whitespace-only nodes are removed, including emphasis boundaries', t => {
  for (const mode of ['karaoke','words']) {
    const f=fixture(t);
    fs.writeFileSync(path.join(f.baseDir,'words.json'),JSON.stringify([{word:'SEND',start:0,end:1},{word:'THE',start:1,end:2},{word:'RESULT',start:2,end:3},{word:'BACK,',start:3,end:4}]));
    build(`motion "M" 5s\n  text "SEND *THE* RESULT BACK," box=40,100,1000,220 word-pad=.14em ${mode==='words'?'words=words.json':''}\n${mode==='karaoke'?'    karaoke at=0,1,2,3\n':''}`,f.out,f);
    const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
    // HF flattens nested templates and can discard standalone whitespace nodes.
    const flattened=html.replace(/>\s+</g,'><');
    const words=[...flattened.matchAll(/id="text-1-word-\d+"[^>]*>([^<]*)<\/span>/g)].map(m=>m[1]);
    assert.deepEqual(words,['SEND',' THE',' RESULT',' BACK,']);
    assert.equal(words.join(''),'SEND THE RESULT BACK,');
    assert.match(flattened,/left:40px;top:100px/);
    assert.match(flattened,/white-space:pre;margin:0 .14em/);
  }
});

test('filter tweens preserve compound treatments, allow repeated and absolute clocks, and do not replace motion', t => {
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'clip.mp4'),'fixture');
  build('motion "M" 8s\n  group id=g at=2 dur=5\n    video "clip.mp4" id=v at=1 dur=4 filter="saturate(1.5) hue-rotate(-12deg) contrast(1.15)"\n      filter at=0,.5 dur=.2 grayscale=1 blur=3 brightness=.75\n      filter abs=on at=5 dur=.2 grayscale=0 blur=0 saturate=2\n      push from=1 to=1.2 at=0 dur=4\n',f.out,f);
  const scene=fs.readFileSync(path.join(f.out,'compositions/g.html'),'utf8');
  const calls=scriptTweens(scene).calls,filters=calls.filter(c=>c.to.filter);
  assert.deepEqual(filters.map(c=>c.at),[1,1.5,3]);
  assert.equal(filters[0].from.filter,'grayscale(0) blur(0px) brightness(1) saturate(1.5) hue-rotate(-12deg) contrast(1.15)');
  assert.equal(filters[0].to.filter,'grayscale(1) blur(3px) brightness(0.75) saturate(1.5) hue-rotate(-12deg) contrast(1.15)');
  assert.match(filters[2].to.filter,/brightness\(0.75\) saturate\(2\)/);
  assert.equal(calls.find(c=>c.to.scale===1.2).at,1);
  assert.equal(filters[0].to.ease,'none');
  assert.equal(filters[0].to.immediateRender,true);
});

test('filter rejects empty, out-of-range, malformed and out-of-bounds treatments with source lines', t => {
  for(const options of ['','grayscale=1.1','blur=-1','brightness=-1','saturate=wat','contrast=-2','hue=no','at=4.9 dur=.5 blur=2']) {
    const f=fixture(t);
    assert.throws(()=>build(`motion "M" 5s\n  rect\n    filter ${options}`,f.out,f),/line 3/);
  }
});

test('type reveals Unicode characters with optional blinking cursor, and generic entrance/exit options stay seekable', t => {
  const {html}=compiled(t,'  text "A 👩" id=typed fill="linear-gradient(red,blue)"\n    type at=.2 dur=.6 cursor=#fff blink=.4\n    pop at=0 dur=.2 scale=1 y=22 rest-rotate=3\n    wipe at=4 dur=.3 reverse=on\n');
  const {calls}=scriptTweens(html),glyphs=calls.filter(c=>c.to.display==='inline');
  assert.equal(glyphs.length,3);assert.deepEqual(glyphs.map(c=>c.at),[.2,.4,.6]);
  assert.match(html,/background:#fff/);assert.match(html,/background-clip:text/);
  assert.ok(calls.some(c=>c.target==='#typed-cursor'&&c.to.opacity===0));
  assert.equal(calls.find(c=>c.to.rotation===3).from.y,22);
  assert.equal(calls.at(-1).to.clipPath,'inset(-50% 100% -50% -50%)');
  for(const source of ['text "A B"\n    type\n    karaoke at=0,1','rect\n    type','text ""\n    type','text "AB"\n    type at=0,2']) {
    const f=fixture(t);assert.throws(()=>build(`motion "M" 5s\n  ${source}`,f.out,f),/type/);
  }
});

test('to from= controls one explicit initial property and supports independent scale axes', t => {
  const {html}=compiled(t,'  rect origin="50% 100%"\n    to at=0 dur=.32 from=0 scale-y=1 ease=power4.out\n');
  const {calls}=scriptTweens(html);assert.equal(calls[0].from.scaleY,0);assert.equal(calls[0].to.scaleY,1);
  assert.match(html,/transform-origin:50% 100%/);
  const f=fixture(t);assert.throws(()=>build('motion "M" 5s\n  rect\n    to from=0 x=1 y=2',f.out,f),/exactly one/);
});

test('natural text heights, CSS padding tuples and explicit pulse starts support source layout and pulse phase', t => {
  const {html}=compiled(t,'  text "Natural" height=auto pad="16 22 8" box-shadow="0 0 26px #00ffff" whitespace=normal\n    pulse from=0 opacity=1 dur=2.1 times=3 ease=sine.inOut\n');
  const {calls}=scriptTweens(html);
  assert.match(html,/height:auto/);assert.match(html,/padding:16px 22px 8px/);
  assert.match(html,/box-shadow:0 0 26px #00ffff;white-space:normal/);
  assert.equal(calls[0].from.opacity,0);assert.equal(calls[0].to.opacity,1);
  assert.equal(calls[1].from.opacity,1);assert.equal(calls[1].to.opacity,0);
  assert.ok(Math.abs(calls[0].to.duration-.35)<1e-12);assert.equal(calls.length,6);
  const f=fixture(t);
  assert.throws(()=>build('motion "M" 5s\n  text "Bad" height=wrong',f.out,f),/height/);
  assert.throws(()=>build('motion "M" 5s\n  text "Bad" pad="1 -2"',f.out,f),/pad/);
  assert.throws(()=>build('motion "M" 5s\n  rect\n    pulse from=0 scale=2 opacity=1',f.out,f),/exactly one/);
});

test('phase 1c: voice clocks resolve phrases, punctuation, offsets and global nested clocks', t => {
  const f=fixture(t);fs.mkdirSync(path.join(f.baseDir,'vo/words'),{recursive:true});
  fs.writeFileSync(path.join(f.baseDir,'vo/timing.json'),JSON.stringify({VS:{v3:2,v4:6},VO_END:9}));
  fs.writeFileSync(path.join(f.baseDir,'vo/words/v3.words.json'),JSON.stringify([{text:'ONE,',start:.4,end:.7},{text:'shot!',start:.8,end:1}]));
  const source='motion "V" @end+1 voice="vo"\n  group at=1 until=@end\n    text "A B" at=@v3"one shot"+0.2 until=@next(v3)-0.1\n      karaoke at=@v3"ONE, SHOT!"+0.2,@v4-1 color=#ff0000\n';
  const m=parse(source,f);assert.equal(m.duration,10);assert.equal(m.children[0].children[0].start,2.6);assert.ok(Math.abs(m.children[0].children[0].duration-3.3)<1e-10);
  build(source,f.out,f);const calls=scriptTweens(fs.readFileSync(path.join(f.out,'compositions/group-1.html'),'utf8')).calls;
  assert.deepEqual(calls.filter(c=>c.to.color==='#ff0000').map(c=>c.at),[1.6,4]);
  assert.equal(parse('motion "V" @end voice="vo"\n  rect at=@next(v4)-1',f).children[0].start,8);
  for(const anchor of ['@v3"missing phrase"','@missing"one shot"','@v3""']) assert.throws(()=>parse(`motion "V" 10s voice="vo"\n  rect at=${anchor}`,f),/line 2: voice .*phrase.*not found/);
  assert.throws(()=>parse('motion "V" 4s\n  rect at=@v3"one shot"',f),/v3.*one shot.*voice=/);
});
test('phase 1c: records from inline, JSON and quoted CSV work in defs, math, nested repeats and conditions',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.baseDir,'rows.json'),JSON.stringify([{name:'J',x:20}]));
  fs.writeFileSync(path.join(f.baseDir,'rows.csv'),'name,x\n"C, ""quoted""",30\n');
  const m=parse('def card(name, x)\n  text "{name}" at=0 box={x},0,100,100\nmotion "D" 2s\n  data inline\n    name="I" x=10\n  data j "rows.json"\n  data c "rows.csv"\n  repeat inline as m\n    repeat j as n\n      if m.x < n.x\n        card "{m.name}{n.name}" {m.x+n.x+i*100}\n  repeat c as m\n    card "{m.name}" {m.x}\n',f);
  assert.deepEqual(m.children.map(n=>n.args[0]),['IJ','C, "quoted"']);assert.equal(m.children[0].o.box,'30,0,100,100');
  assert.throws(()=>parse('motion "D" 2s\n  data x "no.json"\n  rect',f),/line 2.*data file/);
  assert.throws(()=>parse('motion "D" 2s\n  data x\n    n=1\n  repeat x as m\n    text "{m.missing}"',f),/line 5.*unknown name/);
});
test('phase 1c: rich spans, logos, break, bold and small stay editable and escaped',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'logo.svg'),'<svg/>');
  build('motion "R" 3s\n  text "[img logo.svg bg=#fff radius=50%] *Hi*{color=#ff0000 size=44}<br><b>bold</b><small>small</small> <script>"',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.match(html,/<img src="assets\/.*logo.svg"/);assert.match(html,/color:#ff0000;font-size:44px/);assert.match(html,/<br><b style=""><span[^>]*>bold/);assert.match(html,/&lt;script&gt;/);
  assert.throws(()=>build('motion "R" 3s\n  text "<b>unclosed"',f.out,f),/line 2.*unclosed inline/);
});
test('phase 1c: styles override explicitly, drift is bounded and font symlinks copy as files',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'font.woff2'),'font');fs.symlinkSync('font.woff2',path.join(f.baseDir,'alias.woff2'));
  build('motion "S" 5s\n  font "alias.woff2" as Brand\n  style label = size=40 in=fade out=fade drift=on pad=12,18\n  text "Styled" style=label font=Brand size=60\n',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8'),calls=scriptTweens(html).calls;
  assert.match(html,/font-family:"Brand"/);assert.match(html,/font-size:60px/);assert.match(html,/padding:12px 18px/);
  assert.equal(calls.length,3);assert.equal(calls[1].at,.45);assert.equal(calls[1].to.y,-12);assert.equal(calls[1].to.duration,4.5);
  const file=fs.readdirSync(path.join(f.out,'assets'))[0];assert.equal(fs.lstatSync(path.join(f.out,'assets',file)).isSymbolicLink(),false);assert.equal(fs.readFileSync(path.join(f.out,'assets',file),'utf8'),'font');
  assert.throws(()=>parse('motion "S" 3s\n  text "x" style=missing'),/line 2.*unknown style/);
});
test('phase 1c: video loops restart at zero, alternate tracks, preserve rate and fit the final segment',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'v.mp4'),'fixture');
  build('motion "L" 10s\n  group id=g at=2 dur=7\n    video "v.mp4" id=v at=1 dur=6 trim=1 rate=2 length=5 loop=on track=10 fit=cover pos=50%,62%\n      push from=1 to=1.1 dur=6\n',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'compositions/g.html'),'utf8');
  const clips=[...html.matchAll(/<video([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));
  assert.deepEqual(clips.map(c=>Number(c['data-start'])),[1,3,5.5]);assert.deepEqual(clips.map(c=>Number(c['data-duration'])),[2,2.5,1.5]);assert.deepEqual(clips.map(c=>c['data-media-start']),['1','0','0']);assert.deepEqual(clips.map(c=>c['data-track-index']),['10','11','10']);
  assert.match(html,/object-position:50% 62%/);assert.equal(scriptTweens(html).calls.length,1);
  assert.throws(()=>build('motion "L" 2s\n  video "v.mp4" length=1 trim=1 loop=on',f.out,f),/loop trim/);
});

test('phase 1c: caption/word JSON, fades and entrance/exit times use the shared voice clock',t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.baseDir,'vo/words'),{recursive:true});
  fs.writeFileSync(path.join(f.baseDir,'vo/timing.json'),JSON.stringify({VS:{v0:0,v1:2,v2:4},VO_END:6}));
  fs.writeFileSync(path.join(f.baseDir,'words.json'),JSON.stringify([{word:'Hi',start:'@v1+.2',end:'@v1+.6'}]));
  fs.writeFileSync(path.join(f.baseDir,'a.wav'),'fixture');
  build('motion "V" @end voice="vo"\n  text "Hi" at=@v1 until=@v2 words=words.json in=fade in-dur=@v0+.2 out=fade out-dur=@v0+.3\n  captions "words.json" at=@v1 until=@v2\n  audio "a.wav" at=0 dur=@end trim=@v0 fade=@v0+.2,@v0+.3\n',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  const highlights=scriptTweens(html).calls.filter(c=>c.to.color==='#ffe600');assert.equal(highlights[0].at,2.2);
  assert.match(html,/data-fade-in="0.2" data-fade-out="0.3"/);
  const cap=fs.readFileSync(path.join(f.out,'compositions/captions-2.html'),'utf8');assert.match(cap,/data-start="0.20000000000000018"/);
});
test('phase 1c: aliases of one font coexist, decimal math works, and repeated rich data retains quotes and braces',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'f.woff2'),'font');
  build('def card(copy)\n  text "{copy}" at=0\nmotion "D" 4s\n  font "f.woff2" as A\n  font "f.woff2" as B\n  data rows\n    copy="*A*{color=#ff0000} <b>\\\"JSON\\\": {</b>"\n  repeat rows as m\n    card "{m.copy}"\n    rect at=0 box={.5+i*100},0,20,20\n',f.out,f);
  const html=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.match(html,/font-family:"A"/);assert.match(html,/font-family:"B"/);assert.match(html,/left:0\.5px;top:0px;width:20px/);assert.match(html,/color:#ff0000/);assert.match(html.replace(/<[^>]*>/g,''),/&quot;JSON&quot;: \{/);
});
test('phase 1c: time lists preserve commas inside phrases and reject empty entries',t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.baseDir,'vo/words'),{recursive:true});
  fs.writeFileSync(path.join(f.baseDir,'vo/timing.json'),JSON.stringify({VS:{v0:0},VO_END:5}));
  fs.writeFileSync(path.join(f.baseDir,'vo/words/v0.words.json'),JSON.stringify([{text:'One,',start:1,end:1.3},{text:'shot!',start:1.4,end:1.6}]));
  build('motion "V" 5s voice="vo"\n  rect\n    to at=@v0"one, SHOT!",@end-1 dur=.2 x=10',f.out,f);
  assert.deepEqual(scriptTweens(fs.readFileSync(path.join(f.out,'index.html'),'utf8')).calls.map(c=>c.at),[1,4]);
  assert.throws(()=>build('motion "V" 5s\n  rect\n    to at=0,,2 x=10',f.out,f),/line 3.*at must be a number/);
});
test('phase 1c: expanded loops reject generated id collisions and macro errors retain source lines',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'v.mp4'),'fixture');
  assert.throws(()=>build('motion "L" 4s\n  video "v.mp4" id=v length=1 loop=on\n  rect id=v-loop-1 at=0',f.out,f),/line 2.*v-loop-1.*conflicts/);
  assert.throws(()=>parse('def card(copy)\n  text "{copy}"\nmotion "M" 4s\n  card "unclosed'),/line 4.*unclosed/);
});
test('phase 1c: inline CSV columns, data path interpolation, preset inheritance and mixed macro tuples compose',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'rows.json'),'[{"name":"file"}]');
  const source='let file = rows.json\ndef card(copy, b)\n  text "{copy}" at=0 box={b} style=child\nmotion "D" 3s\n  style base = size=40 in=fade drift=on\n  style child = style=base color=#ff0000\n  data rows(name,x)\n    "A, B",20\n  data fromFile "{file}"\n  repeat rows as m\n    card "{m.name}" {m.x+i*50},10,200,100\n';
  const m=parse(source,f);assert.equal(m.children[0].args[0],'A, B');assert.equal(m.children[0].o.box,'20,10,200,100');assert.equal(m.children[0].o.in,'fade');assert.equal(m.children[0].o.color,'#ff0000');
  assert.throws(()=>parse('motion "D" 3s\n  style child = style=missing\n  rect',f),/line 2.*unknown style/);
  assert.throws(()=>parse('motion "D" 3s\n  data rows(a,b)\n    one\n  rect',f),/line 2.*CSV row width/);
});

test('hardening: paint categories beat source order and explicit zero layers survive',t=>{
  const f=fixture(t);
  build('motion "Paint" 2s\n  text "Top" at=0\n  rect at=0\n  rect at=0 box=10,10,20,20\n  text "Explicit" at=0 layer=0',f.out,f);
  const h=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.match(h,/id="text-1"[^>]*z-index:20/);
  assert.match(h,/id="rect-2"[^>]*z-index:0/);
  assert.match(h,/id="rect-3"[^>]*z-index:10/);
  assert.match(h,/id="text-4"[^>]*z-index:0/);
});
test('hardening: single words file has v0, phrase shorthand, end and offsets',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.baseDir,'voice.words.json'),JSON.stringify([{word:'click',start:.2,end:.4},{word:'Create!',start:.5,end:1.5}]));
  const m=parse('motion "Words" @end voice="voice.words.json"\n  text "Ready" at=@"click create"+.1 until=@next(v0)',f);
  assert.equal(m.duration,1.5);assert.equal(m.children[0].start,.3);
  assert.equal(parse('motion "W" 2s voice="voice.words.json"\n  rect at=@v0',f).children[0].start,0);
  assert.throws(()=>parse('motion "W" 2s voice="voice.words.json"\n  rect at=@"absent"',f),/line 2.*phrase.*not found/);
});
test('hardening: bundled synthetic sound names copy real WAVs and route to sfx',t=>{
  const f=fixture(t);
  build('motion "SFX" 3s\n'+['whoosh','pop','ping','click','riser'].map((s,i)=>`  ${i%2?'audio':'sfx'} "${s}" at=0`).join('\n'),f.out,f);
  const h=fs.readFileSync(path.join(f.out,'index.html'),'utf8');
  assert.equal((h.match(/data-audio-group="sfx"/g)||[]).length,5);
  for(const file of fs.readdirSync(path.join(f.out,'assets'))) assert.equal(fs.readFileSync(path.join(f.out,'assets',file)).toString('ascii',0,4),'RIFF');
});

test('hardening: fit defaults on, stroke/shadow reserve ink, fit=off preserves typography',t=>{
  const {html}=compiled(t,'  text "Outlined" box=100,100,800,180 stroke="8px black" shadow="10px -5px 12px black"\n  text "Manual" at=0 box=200,300,800,100 fit=off\n');
  assert.match(html,/data-orb-fit="64"/);assert.doesNotMatch(html,/data-orb-inset/);
  assert.match(html,/padding:0px/);assert.match(html,/overflow:visible/);
  assert.doesNotMatch(html,/id="text-2-motion" data-orb-fit/);
});
test('layout: authored boxes are never changed; a text box fully outside the canvas is reported',t=>{
  const f=fixture(t);
  const m=build('motion "Safe" 1000x1000 3s\n  text "A" box=0,0,500,100\n    punch scale=1.3\n    shake x=30 y=20\n    spin deg=90\n  rect at=0 box=950,950,100,100\n  text "B" at=0 box=900,-20,300,100\n  text "anchor" at=0 box=80,420,1000,1000 width=auto sizing=content\n  text "gone" at=0 box=1200,0,300,100\n',f.out,f);
  assert.deepEqual(m.children.map(n=>n.box),[[0,0,500,100],[950,950,100,100],[900,-20,300,100],[80,420,1000,1000],[1200,0,300,100]]);
  assert.deepEqual(m.warnings.filter(w=>/outside the canvas/.test(w.message)).map(w=>w.line),[9]);
});
test('layout: every authored box in the long examples reaches the output unchanged',t=>{
  for(const name of ['argon-review','agentic-chef']) {
    const f=fixture(t),dir=path.join(__dirname,'../examples/hf');
    if(!fs.existsSync(path.join(dir,name+'.orb'))){t.diagnostic(name+' is not in this checkout');continue;}
    let m;try{m=build(fs.readFileSync(path.join(dir,name+'.orb'),'utf8'),f.out,{baseDir:dir});}catch(e){if(/not found/.test(e.message)){t.diagnostic(name+' assets not on this machine: '+e.message);continue;}throw e;}
    let checked=0;
    (function walk(nodes,stacked){for(const n of nodes){if(n.o.box && !stacked){assert.deepEqual(n.box,String(n.o.box).split(',').map(Number),`${name} line ${n.line}`);checked++;}walk(n.children,n.o.layout==='stack');}})(m.children,false);
    assert.ok(checked>20,`${name}: ${checked} boxes checked`);
  }
});

test('hardening: escaped braces stay literal through definitions and repetitions',()=>{
  const m=parse('def label(copy)\n  text "{copy}" at=0\nmotion "Literal" 2s\n  repeat 2 as i\n    label "\\{copy\\} {i} \\{\\}"');
  assert.deepEqual(m.children.map(n=>n.args[0]),['{copy} 1 {}','{copy} 2 {}']);
  assert.throws(()=>parse('motion "Bad" 2s\n  text "{missing}"'),/line 2.*unknown name/);
});
test('hardening: visual options and aliases are shared across visuals',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'x.png'),'fixture');fs.writeFileSync(path.join(f.baseDir,'v.mp4'),'fixture');
  for(const item of ['text "Hi"','image "x.png"','video "v.mp4"','rect','group']) {
    build(`motion "Shared" 2s\n  ${item} at=0 box=300,300,400,200 radius=12 border="2px solid white" box-shadow="0 0 4px black" clip=on opacity=.6 filter="blur(1px)"`,f.out,f);
    const h=fs.readFileSync(path.join(f.out,item==='group'?'compositions/group-1.html':'index.html'),'utf8');
    assert.match(h,/opacity:0.6/);assert.match(h,/border-radius:12px/);assert.match(h,/box-shadow:0 0 4px black/);
  }
  assert.equal(parse('motion "A" 1s\n  text "X" colour=#fff font-size=42').children[0].o.color,'#fff');
  assert.throws(()=>parse('motion "A" 1s\n  image "x" raduis=3'),/radius.*Valid options:.*opacity/);
  assert.throws(()=>parse('motion "A" 1s\n  rect shadow=x box-shadow=y'),/duplicate option 'shadow'/);
});
test('hardening: assets fall back to source, ORB_ASSETS fonts/sfx and suggest filenames',t=>{
  const f=fixture(t),old=process.env.ORB_ASSETS;
  fs.mkdirSync(path.join(f.baseDir,'media'));fs.mkdirSync(path.join(f.baseDir,'shared/fonts'),{recursive:true});
  fs.writeFileSync(path.join(f.baseDir,'source.png'),'image');fs.writeFileSync(path.join(f.baseDir,'shared/fonts','brand.woff2'),'font');
  process.env.ORB_ASSETS=path.join(f.baseDir,'shared');
  try {
    build('motion "Assets" 2s assets=media\n  font "brand.woff2" as Brand\n  image "source.png"',f.out,f);
    assert.equal(fs.readdirSync(path.join(f.out,'assets')).length,2);
    assert.throws(()=>build('motion "Missing" 2s assets=media\n  image "sorce.png"',f.out,f),/line 2.*searched:.*media.*shared.*did you mean 'source.png'/);
  } finally {if(old===undefined)delete process.env.ORB_ASSETS;else process.env.ORB_ASSETS=old;}
});

test('hardening: emphasis and rich styles keep spaces through HF flattening',t=>{
  for(const text of ['YOUR *CLOUD* BILL','*YOUR* *CLOUD* BILL','<b>YOUR</b> *CLOUD*{color=#fff} <small>BILL</small>']) {
    const {html}=compiled(t,`  text "${text}"\n`);
    const markup=html.match(/<span id="text-1-value">(.*?)<\/div>/s)[1];
    const words=markup.replace(/>\s+</g,'><').replace(/<[^>]*>/g,'');
    assert.equal(words,'YOUR CLOUD BILL');
  }
});
test('hardening: simultaneous overlapping text warns with both lines; stack separates it',t=>{
  const f=fixture(t),body='    text "A" at=0 box=200,200,800,200\n    text "B" at=0 box=200,200,800,200\n';
  const overlap=build('motion "Overlap" 3s\n  group\n'+body,f.out,f);
  assert.ok(overlap.warnings.some(w=>w.line===3 && /line 4.*20%/.test(w.message)));
  const stack=build('motion "Stack" 3s\n  group layout=stack\n'+body,f.out,f);
  assert.ok(!stack.warnings.some(w=>/content_overlap/.test(w.message)));
  const [a,b]=stack.children[0].children;assert.ok(a.box[1]+a.box[3]<=b.box[1]+.01);
  const sequential=build('motion "Time" 3s\n  text "A" at=0 dur=1\n  text "B" at=1 dur=1',f.out,f);
  assert.ok(!sequential.warnings.some(w=>/content_overlap/.test(w.message)));
});
test('hardening: automatic ink chooses higher worst-case contrast and remains seekable',t=>{
  const {contrastInk}=require('../src/hf-text');
  assert.equal(contrastInk(['#fff']),'#000000');assert.equal(contrastInk(['rgb(10, 20, 30)']),'#ffffff');
  assert.equal(contrastInk(['#ffffff','#eeeeee']),'#000000');
  const {html}=compiled(t,'  text "Auto" color=auto bg=#eee\n');
  assert.match(html,/data-orb-auto="true"/);assert.match(html,/set:\(\)=>updateOrbColor/);
  assert.doesNotMatch(html,/;color:auto/);
  scriptTweens(html);
});

test('hardening: checker maps descendants, both overlap lines, macros and contrast',t=>{
  const f=fixture(t);
  build('def title(copy)\n  text "{copy}" at=0\nmotion "Map" 2s\n  title "A"\n  text "B" at=0',f.out,f);
  const {checkProject,mapFinding}=require('../src/hf-check'),map=JSON.parse(fs.readFileSync(path.join(f.out,'orb-map.json'),'utf8'));
  assert.deepEqual(mapFinding({selector:'#group__text-1-word-0',containerSelector:'#text-2-motion'},map),[2,5]);
  let args;
  const result=checkProject(f.out,{log(){},run(cmd,a){args=a;return {status:1,stdout:JSON.stringify({ok:false,browserSkipped:false,contrast:{findings:[{selector:'#text-2-motion',severity:'error',code:'contrast',message:'Low contrast'}]}})};}});
  assert.equal(result.ok,false);assert.equal(result.errors,1);assert.match(result.messages[0],/^line 5: error: contrast/);
  assert.ok(args.includes('--at-transitions'));assert.ok(args.includes('--json'));
  const skip=checkProject(f.out,{log(){},run(){return {status:0,stdout:'{"ok":true,"browserSkipped":true}'};}});
  assert.equal(skip.ok,false);
});

test('hardening: opacity survives entrance/pop and rect clipping is honored',t=>{
  const {html}=compiled(t,'  rect opacity=.4 clip=on in=fade\n    pop at=1 dur=.2\n');
  const {calls}=scriptTweens(html);assert.equal(calls[0].to.opacity,.4);assert.equal(calls[1].to.opacity,.4);
  assert.match(html,/overflow:hidden/);
});
test('hardening: unitless zero shadows and font-relative stroke count toward ink padding',()=>{
  const {textInset}=require('../src/hf-layout');
  assert.equal(textInset({stroke:'4px black',shadow:'0 6px 8px black'}),26);
  assert.equal(textInset({size:100,stroke:'.1em black',shadow:'-4px 0 2px black, 0 2px 10px black'}),32);
});
test('hardening: voice directory and prefix shorthands resolve a single companion file',t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.baseDir,'voice'));
  fs.writeFileSync(path.join(f.baseDir,'voice/voice.words.json'),'[{"text":"hello","start":1,"end":2}]');
  for(const voice of ['voice','voice/voice'])assert.equal(parse(`motion "V" @end voice=${voice}\n  rect at=@voice"hello"`,f).children[0].start,1);
});
test('hardening: contact sheet requests exactly one frame per second and tiles a PNG',t=>{
  const f=fixture(t);fs.mkdirSync(f.out);let captured,ffmpeg;
  const {contactSheet}=require('../src/hf-check');
  const output=contactSheet(f.out,{duration:2.4},{run(cmd,args){
    if(cmd==='npx') {
      captured=args;const folder=args[args.indexOf('--output')+1];fs.mkdirSync(folder);
      for(let i=0;i<3;i++)fs.writeFileSync(path.join(folder,`at-${i}s.png`),'png');
      return {status:0,stdout:'{}'};
    }
    ffmpeg=args;return {status:0};
  }});
  assert.equal(captured[captured.indexOf('--at')+1],'0,1,2');assert.ok(captured.includes('--no-end'));
  assert.match(output,/contact-sheet\.png$/);assert.match(ffmpeg[ffmpeg.indexOf('-vf')+1],/tile=3x1:nb_frames=3/);
});
test('hardening: contrast selectors without ids still map text/bounds to source lines',()=>{
  const {mapFinding}=require('../src/hf-check');
  const map={ids:{a:2,b:8},items:[{id:'a',line:2,text:'same',start:0,end:3,box:[0,0,100,20]},{id:'b',line:8,text:'same',start:0,end:3,box:[300,200,100,20]}]};
  assert.deepEqual(mapFinding({selector:'div > div:nth-of-type(2)',text:'same',bbox:{x:300,y:200,width:80,height:20},time:1},map),[8]);
});

test('hardening: groups of full-frame footage stay below explicitly layered captions',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'v.mp4'),'fixture');fs.writeFileSync(path.join(f.baseDir,'w.json'),'[{"word":"Hi","start":0,"end":1}]');
  const m=build('motion "Background group" 3s\n  group\n    video "v.mp4"\n  captions "w.json" layer=5\n',f.out,f);
  assert.equal(m.children[0].o.layer,0);assert.equal(m.children[1].start,0);
  const h=fs.readFileSync(path.join(f.out,'index.html'),'utf8');assert.match(h,/id="group-1"[^>]*z-index:0/);
});

test('overlapping simultaneous text is reported, never silently moved',t=>{
  const f=fixture(t),m=build('motion "Nudge" 1920x1080 3s\n  text "120 tok/s" box=1504,406,240,56 at=0\n  text "FASTEST" box=1680,402,160,52 at=0\n',f.out,f);
  assert.deepEqual(m.children.map(n=>n.box),[[1504,406,240,56],[1680,402,160,52]]);
  assert.ok(m.warnings.some(w=>/content_overlap/.test(w.message)));
});
test('hardening: automatic ink samples readable media pixels',()=>{
  const {updateOrbColor,contrastInk}=require('../src/hf-text'),vm=require('vm');
  const rect={left:0,top:0,width:100,height:100};
  const media={naturalWidth:100,naturalHeight:100,matches:()=>true,getBoundingClientRect:()=>rect};
  const el={style:{},contains:()=>false,getBoundingClientRect:()=>rect};
  const context={el,contrastInk,getComputedStyle:()=>({opacity:'1',backgroundColor:'rgba(0,0,0,0)',backgroundImage:'none',objectFit:'cover',objectPosition:'50% 50%'}),document:{elementsFromPoint:()=>[media],createElement:()=>({getContext:()=>({clearRect(){},drawImage(){},getImageData:()=>({data:[255,255,255,255]})})})}};
  vm.runInNewContext(`(${updateOrbColor.toString()})(el)`,context);
  assert.equal(el.style.color,'#000000');
});

test('hardening: background alias paints rects/groups and captions share text/word JSON',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.baseDir,'words.json'),'[{"text":"Hi","start":0,"end":1}]');
  build('motion "Consistent" 2s\n  rect background=#123456\n  group at=0 background=#654321\n  captions "words.json"',f.out,f);
  assert.match(fs.readFileSync(path.join(f.out,'index.html'),'utf8'),/background:#123456/);
  assert.match(fs.readFileSync(path.join(f.out,'compositions/group-2.html'),'utf8'),/background:#654321/);
});

test('clip reveals never trim ink: the open state reaches beyond the box on every side',t=>{
  const {html}=compiled(t,'  text "OUTLINED" at=0 box=100,100,800,130 size=100 stroke="10px #000" shadow="0 8px #000"\n    wipe dur=.6 dir=r\n  text "IN" at=0 box=100,300,800,130 in=draw\n  rect at=0 box=100,500,400,40 color=#f00\n    drain dur=1\n');
  assert.doesNotMatch(html,/inset\(0 0 0 0\)/);assert.doesNotMatch(html,/inset\(0 100% 0 0\)/);
  assert.match(html,/inset\(-50% -50% -50% -50%\)/);assert.match(html,/inset\(-50% 100% -50% -50%\)/);
});
