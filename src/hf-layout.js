// Conservative canvas geometry, independent of the player and browser runtime.
function textInset(o) {
  const size=Number(o.size)||64;
  const length=(v,u)=>Number(v)*(u==='em'?size:u==='rem'?16:1);
  const sw=String(o.stroke||'').match(/(-?[\d.]+)(px|rem|em)?/);
  const stroke=sw?Math.max(0,length(sw[1],sw[2])):0;
  let inset=stroke;
  for(const shadow of String(o.shadow||'').split(/,(?![^()]*\))/)) {
    const v=[...shadow.replace(/rgba?\([^)]*\)|#[\da-f]+/gi,'').matchAll(/(?:^|\s)(-?(?:\d+(?:\.\d*)?|\.\d+))(px|rem|em)?(?=\s|$)/g)].map(m=>length(m[1],m[2]));
    if(v.length>=2) inset=Math.max(inset,stroke+Math.max(Math.abs(v[0]),Math.abs(v[1]))+Math.max(0,v[2]||0)*2);
  }
  return Math.ceil(inset);
}
function envelope(n,w,h) {
  let sx=1,sy=1,dx=0,dy=0,rotation=false;
  const val=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  for(const edge of ['in','out']) {
    const name=n.o[edge];
    if(/slide/.test(name)) dx=Math.max(dx,80);
    if(/rise/.test(name)) dy=Math.max(dy,60);
    if(/lift/.test(name)) dy=Math.max(dy,24);
  }
  dx=Math.max(dx,Math.abs(val(n.o['in-x'])));dy=Math.max(dy,Math.abs(val(n.o['in-y'])));
  sx=sy=Math.max(1,val(n.o['in-scale'],1));
  let x=0,y=0,deg=0;
  for(const a of n.animations) {
    const o=a.o;
    let scale=1;
    if(['punch','pulse','pop'].includes(a.kind)) scale=val(o.scale,a.kind==='pop'?1:1.12);
    if(a.kind==='to') {scale=val(o.scale,1);x=val(o.x,x);y=val(o.y,y);deg=val(o.rotate,deg);sx=Math.max(sx,val(o['scale-x'],1));sy=Math.max(sy,val(o['scale-y'],1));}
    if(a.kind==='push') for(const v of [o.from??'1',o.to??'1.1']) {const t=String(v).split(',').map(Number);scale=Math.max(scale,t[0]||1);dx=Math.max(dx,Math.abs(t[1]||0));dy=Math.max(dy,Math.abs(t[2]||0));}
    if(a.kind==='shake') {dx=Math.max(dx,Math.abs(x)+Math.abs(val(o.x,10)));dy=Math.max(dy,Math.abs(y)+Math.abs(val(o.y)));}
    if(a.kind==='spin' || val(o.rotate) || val(o['rest-rotate']) || deg) rotation=true;
    if(a.kind==='pop') dy=Math.max(dy,Math.abs(val(o.y)));
    if(a.kind==='to' && o.from!==undefined) {if(o.x!==undefined) dx=Math.max(dx,Math.abs(val(o.from)));if(o.y!==undefined)dy=Math.max(dy,Math.abs(val(o.from)));if(o.scale!==undefined)scale=Math.max(scale,val(o.from,1));}
    // Back/elastic eases can travel beyond their endpoint; reserve a generous envelope.
    const overshoot=/back|spring|elastic/.test(o.ease||n.o.ease||(['pop'].includes(a.kind)?'back':''))?1.35:1;
    sx=Math.max(sx,scale*overshoot);sy=Math.max(sy,scale*overshoot);
    dx=Math.max(dx,Math.abs(x)*overshoot);dy=Math.max(dy,Math.abs(y)*overshoot);
  }
  dy=Math.max(dy,Math.abs(n.o.drift==='on'?-12:val(n.o.drift)));
  if(n.o.words || n.animations.some(a=>a.kind==='karaoke')) {sx*=1.12;sy*=1.12;}
  const pad=n.kind==='text'?textInset(n.o):0;
  // A rotation may sweep through any angle. The diagonal bounds the complete sweep.
  let ew=(w+2*pad)*sx,eh=(h+2*pad)*sy;
  if(rotation) ew=eh=Math.hypot(ew,eh);
  // Noncentral origins can move a scaled/rotated box by another half extent.
  if(n.o.origin && n.o.origin!=='50% 50%') {ew*=2;eh*=2;}
  return [ew+2*dx,eh+2*dy];
}
function prepareLayout(m, warn) {
  function walk(nodes,parent,offset=[0,0],moving=false) {
    for(const n of nodes) {
      let b=n.layoutBox || (n.o.box?String(n.o.box).split(',').map(Number):[0,0,parent[0],parent[1]]);
      n.originalBox=b.slice();
      n.background=['rect','image','video'].includes(n.kind) && b[0]<=0 && b[1]<=0 && b[0]+b[2]>=parent[0] && b[1]+b[3]>=parent[1];
      const explicitLayer=n.o.layer!==undefined;
      n.o.layer ??= n.background?0:['text','captions','comp','html'].includes(n.kind)?20:10;
      // Full-frame stages deliberately contain backgrounds, camera moves and other clips.
      const stage=n.kind==='group' && b[0]===0 && b[1]===0 && b[2]===parent[0] && b[3]===parent[1];
      // Authored boxes are never changed at build time: a box is often only an anchor for content-sized text and may
      // run past the frame edge on purpose. The one sure mistake, a text box entirely outside the canvas, is reported.
      if(['text','captions'].includes(n.kind)) {
        const x=b[0]+offset[0],y=b[1]+offset[1];
        // Inside a group that moves (a scrolling list, a camera move) a box may start off canvas on purpose.
        if(!moving && (x>=m.width || y>=m.height || x+b[2]<=0 || y+b[3]<=0)) warn(n.line,'text box is entirely outside the canvas and will not be seen');
      }
      n.box=b;
      if(n.kind==='group' && n.o.layout==='stack') {
        const children=n.children.filter(c=>c.kind!=='audio');
        const left=Math.max(0,m.width*.1-offset[0]-b[0]),top=Math.max(0,m.height*.1-offset[1]-b[1]);
        const width=Math.max(1,Math.min(b[2],m.width*.9-offset[0]-b[0])-left),height=Math.max(1,Math.min(b[3],m.height*.9-offset[1]-b[1])-top);
        const boxes=children.map(c=>c.o.box?String(c.o.box).split(',').map(Number):[0,0,width,height/Math.max(1,children.length)]);
        const sizes=boxes.map((cb,i)=>envelope(children[i],cb[2],cb[3])[1]);
        const factor=Math.min(1,height/Math.max(1,sizes.reduce((a,b)=>a+b,0)));let y=top;
        children.forEach((c,i)=>{const cb=boxes[i],h=cb[3]*factor,eh=sizes[i]*factor;c.layoutBox=[left,y+(eh-h)/2,Math.min(width,cb[2]),h];y+=eh;});
      }
      walk(n.children,[b[2],b[3]],[offset[0]+b[0],offset[1]+b[1]],moving || n.animations.length>0);
      if(n.kind==='group' && !explicitLayer && n.children.length)n.o.layer=Math.max(...n.children.map(c=>Number(c.o.layer)));
    }
  }
  walk(m.children,[m.width,m.height]);
  avoidNudgeCollisions(m,warn);
}
module.exports={textInset,envelope,prepareLayout};

function overlapWarnings(m,warn) {
  const texts=[];
  function walk(nodes,x=0,y=0){for(const n of nodes){const b=n.box;if(n.kind==='text')texts.push({n,b:[x+b[0],y+b[1],b[2],b[3]]});walk(n.children,x+b[0],y+b[1]);}}
  walk(m.children);
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++) {
    const {n:a,b:ab}=texts[i],{n:b,b:bb}=texts[j];
    if(Math.min(a.start+a.duration,b.start+b.duration)-Math.max(a.start,b.start)<1e-6)continue;
    const area=Math.max(0,Math.min(ab[0]+ab[2],bb[0]+bb[2])-Math.max(ab[0],bb[0]))*Math.max(0,Math.min(ab[1]+ab[3],bb[1]+bb[3])-Math.max(ab[1],bb[1]));
    if(area>.2*Math.min(ab[2]*ab[3],bb[2]*bb[3]))warn(a.line,`possible content_overlap with line ${b.line}: simultaneous text boxes overlap by more than 20%; use group layout=stack or separate boxes/times`);
  }
}
module.exports.overlapWarnings=overlapWarnings;

// Safety nudges must not turn a near-edge label into a new persistent collision.
// Preserve authored overlaps unless clamping has increased their coverage.
function avoidNudgeCollisions(m,warn) {
  const texts=[];
  function collect(nodes,parent=[0,0,m.width,m.height]){for(const n of nodes){const b=n.box;if(n.kind==='text')texts.push({n,parent});collect(n.children,[parent[0]+b[0],parent[1]+b[1],b[2],b[3]]);}}
  collect(m.children);
  const global=(t,b=t.n.box)=>[t.parent[0]+b[0],t.parent[1]+b[1],b[2],b[3]];
  const coverage=(a,b)=>Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]))/Math.min(a[2]*a[3],b[2]*b[3]);
  const together=(a,b)=>Math.min(a.n.start+a.n.duration,b.n.start+b.n.duration)>Math.max(a.n.start,b.n.start)+1e-6;
  for(const t of texts) {
    const b=global(t),old=global(t,t.n.originalBox),others=texts.filter(o=>o!==t && together(t,o));
    const newCollisions=others.filter(o=>coverage(b,global(o))>Math.max(.2,coverage(old,global(o,o.n.originalBox))+.05));
    if(!newCollisions.length)continue;
    const [ew,eh]=envelope(t.n,b[2],b[3]),mx=(ew-b[2])/2,my=(eh-b[3])/2;
    const left=Math.max(m.width*.1,t.parent[0])+mx,right=Math.min(m.width*.9,t.parent[0]+t.parent[2])-mx;
    const top=Math.max(m.height*.1,t.parent[1])+my,bottom=Math.min(m.height*.9,t.parent[1]+t.parent[3])-my;
    const candidates=[];
    for(const o of newCollisions){const r=global(o);candidates.push([r[0]-b[2]-8,b[1]],[r[0]+r[2]+8,b[1]],[b[0],r[1]-b[3]-8],[b[0],r[1]+r[3]+8]);}
    candidates.sort((a,c)=>Math.hypot(a[0]-b[0],a[1]-b[1])-Math.hypot(c[0]-b[0],c[1]-b[1]));
    const chosen=candidates.find(([x,y])=>x>=left && y>=top && x+b[2]<=right && y+b[3]<=bottom && others.every(o=>coverage([x,y,b[2],b[3]],global(o))<=.2));
    if(chosen){t.n.box[0]=chosen[0]-t.parent[0];t.n.box[1]=chosen[1]-t.parent[1];warn(t.n.line,'adjusted safety nudge to avoid text on line '+newCollisions[0].n.line);}
  }
}
