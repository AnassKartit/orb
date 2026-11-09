// Runs in the generated HF project, after fonts load and before capture settles.
// Keep the fitter idempotent: Studio remounts templates and can seek without callbacks.
function fitOrbText(root=document) {
  for(const el of root.querySelectorAll('[data-orb-fit]')) {
    const cs=getComputedStyle(el), box=el.parentElement;
    const max=Number(el.dataset.orbFit), inset=Number(el.dataset.orbInset)||0;
    const width=box.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-2*inset;
    const height=box.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-2*inset;
    // Start from the size the author wrote and measure the real layout. (A single-line estimate of the whole
    // text shrinks every multi-line heading, so it is not used.)
    let size=max;
    const inline=[...el.querySelectorAll('[style*="font-size"]')].map(e=>[e,Number(e.dataset.orbSize||parseFloat(e.style.fontSize))]);
    const set=v=>{el.style.fontSize=v+'px';for(const [e,s] of inline){e.dataset.orbSize=s;e.style.fontSize=s*v/max+'px';}};
    const fits=()=>{
      const r=document.createRange();r.selectNodeContents(el);
      const rects=[...r.getClientRects()];
      // Untransformed dimensions and actual glyph ranges catch long words and rich runs.
      const own=el.getBoundingClientRect(),scale=own.width/(el.offsetWidth||1)||1;
      const textWidth=rects.length?Math.max(...rects.map(r=>r.right))-Math.min(...rects.map(r=>r.left)):0;
      const textHeight=rects.length?Math.max(...rects.map(r=>r.bottom))-Math.min(...rects.map(r=>r.top)):0;
      return textHeight/scale<=Math.max(1,height)+1 && el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=box.clientHeight+1 && textWidth/scale<=Math.max(1,width)+1 && (el.offsetHeight<=box.clientHeight+1);
    };
    // Binary search DOM layout as the HF helper only measures single-line plain text.
    // Hard floor: fitting may take a little off, never make text unreadable. Below 60% of the authored size
    // the author's size wins and the text overflows visibly, which a reviewer sees and the check reports.
    const floor=max*.6;
    let lo=floor,hi=size;set(size);
    if(!fits()) {set(floor);if(!fits()){size=max;el.dataset.orbOverflow='true';}else{for(let i=0;i<10;i++){const mid=(lo+hi)/2;set(mid);if(fits())lo=mid;else hi=mid;}size=lo;}}
    set(size);
    el.style.overflow='visible';
  }
}
function installOrbText() {
  if(!document.querySelectorAll || window.__orbTextInstalled) return;
  window.__orbTextInstalled=true;
  const run=()=>{for(const el of document.querySelectorAll('[data-orb-auto]'))updateOrbColor(el);fitOrbText();};
  run();
  document.fonts?.ready.then(run);
  const colors=()=>{for(const el of document.querySelectorAll('[data-orb-auto]'))updateOrbColor(el);};
  for(const event of ['load','loadeddata','seeked'])document.addEventListener(event,colors,true);
  if(window.MutationObserver) new MutationObserver(records=>{if(records.some(r=>r.type==='childList'))run();}).observe(document.body,{childList:true,subtree:true});
}
module.exports={fitOrbText,installOrbText,contrastInk,updateOrbColor};

function contrastInk(colors) {
  const rgb=s=>{
    if(s.startsWith('#')) {let h=s.slice(1);if(h.length===3||h.length===4)h=h.split('').map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)/255);}
    const v=s.match(/[\d.]+/g);return v?.length>=3?v.slice(0,3).map(n=>Number(n)/255):[.04,.06,.1];
  };
  const luminance=s=>rgb(s).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);
  const ls=colors.map(luminance);
  return Math.min(...ls.map(l=>(l+.05)/.05))>=Math.min(...ls.map(l=>1.05/(l+.05)))?'#000000':'#ffffff';
}
function updateOrbColor(el) {
  if(!el?.getBoundingClientRect)return;
  const r=el.getBoundingClientRect(),colors=[];
  const layers=[el,...document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2)];
  for(const layer of layers) {
    if(layer!==el && el.contains(layer))continue;
    const cs=getComputedStyle(layer);
    if(Number(cs.opacity)===0)continue;
    // Same-origin images and decoded video frames can be sampled without a service.
    if(layer.matches?.('img,video')) {
      const width=layer.videoWidth||layer.naturalWidth,height=layer.videoHeight||layer.naturalHeight;
      if(width && height)try {
        const box=layer.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        const scale=cs.objectFit==='cover'?Math.max(box.width/width,box.height/height):cs.objectFit==='contain'?Math.min(box.width/width,box.height/height):null;
        const pos=cs.objectPosition.split(' ').map(v=>parseFloat(v)/100);
        for(const dx of [.2,.5,.8])for(const dy of [.3,.7]) {
          const x=r.left+r.width*dx-box.left,y=r.top+r.height*dy-box.top;
          const sx=scale?(x-(box.width-width*scale)*(pos[0]||0))/scale:x*width/box.width;
          const sy=scale?(y-(box.height-height*scale)*(pos[1]??.5))/scale:y*height/box.height;
          if(sx<0||sy<0||sx>=width||sy>=height)continue;
          ctx.clearRect(0,0,1,1);ctx.drawImage(layer,sx,sy,1,1,0,0,1,1);
          const pixel=ctx.getImageData(0,0,1,1).data;
          if(pixel[3]>250)colors.push(`rgb(${pixel[0]},${pixel[1]},${pixel[2]})`);
        }
        if(colors.length)break;
      }catch{} // A cross-origin or not-yet-decoded frame falls back to the CSS backdrop.
    }
    const stops=cs.backgroundImage?.match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi);
    if(stops?.length){colors.push(...stops);break;}
    const c=cs.backgroundColor,nums=c?.match(/[\d.]+/g);
    if(nums?.length>=3 && (nums.length===3 || Number(nums[3])>=.99)){colors.push(c);break;}
  }
  el.style.color=contrastInk(colors.length?colors:['#0b0f1a']);
}
