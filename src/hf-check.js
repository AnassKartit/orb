const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
function runHF(args,run=spawnSync) {
  const result=run('npx',['--no-install','hyperframes',...args],{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,npm_config_offline:'true',HF_WORKERS:process.env.HF_WORKERS||'1'}});
  if(result.error)throw new Error(`HyperFrames unavailable offline: ${result.error.message}`);
  let report;try{report=JSON.parse(result.stdout);}catch{throw new Error(`HyperFrames ${args[0]} did not return JSON (exit ${result.status}): ${(result.stderr||result.stdout||'').slice(-2000)}`);}
  return {report,status:result.status};
}
function mapFinding(finding,map) {
  const keys=Object.keys(map.ids).sort((a,b)=>b.length-a.length),lines=[];
  for(const selector of [finding.selector,finding.containerSelector,finding.element,finding.target].filter(s=>typeof s==='string')) {
    const clean=selector.replace(/\\/g,'');
    for(const id of keys) {
      const re=new RegExp('(?:^|[#\\s"\'=]|__)'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[-\\s.:>\\["\']|__)');
      if(re.test(clean) && !keys.some(other=>other.length>id.length && other.startsWith(id+'-') && clean.includes(other)))lines.push(map.ids[id]);
    }
  }
  if(!lines.length && map.items) {
    const plain=s=>String(s).replace(/<[^>]*>|\*|\{[^}]*\}/g,'').replace(/\s+/g,' ').trim();
    const text=plain(finding.text||''),bb=finding.bbox;
    const candidates=map.items.filter(n=>(finding.time===undefined || (finding.time>=n.start && finding.time<=n.end)) && (!text || plain(n.text).includes(text)));
    if(bb)candidates.sort((a,b)=>{
      const score=n=>Math.hypot(n.box[0]+n.box[2]/2-bb.x-bb.width/2,n.box[1]+n.box[3]/2-bb.y-bb.height/2);
      return score(a)-score(b);
    });
    if(candidates.length && (text || bb))lines.push(candidates[0].line);
  }
  if(!lines.length && finding.sourceFile) {const id=path.basename(finding.sourceFile,'.html');if(map.ids[id])lines.push(map.ids[id]);}
  return [...new Set(lines)];
}
function checkProject(dir,options={}) {
  const map=JSON.parse(fs.readFileSync(path.join(dir,'orb-map.json'),'utf8'));
  const {report,status}=runHF(['check',path.resolve(dir),'--json','--at-transitions','--max-issues','10000'],options.run);
  const findings=Object.values(report).flatMap(s=>s?.findings||[]);
  const messages=[];
  for(const f of findings) {
    const lines=mapFinding(f,map),line=lines[0]||1;
    const message=`line ${line}: ${f.severity}: ${f.code}: ${f.message}${lines.length>1?` (also line ${lines.slice(1).join(', ')})`:''}${f.time!==undefined?` at ${f.time}s`:''}`;
    if(!messages.includes(message))messages.push(message);
  }
  for(const message of messages)(options.log||console.error)(message);
  const errors=findings.filter(f=>f.severity==='error').length;
  const ok=report.ok===true && !report.browserSkipped && status===0 && !errors;
  fs.writeFileSync(path.join(dir,'orb-check.json'),JSON.stringify({ok,errors,messages,report},null,2)+'\n');
  if(report.browserSkipped)(options.log||console.error)('line 1: HyperFrames skipped browser checks; verification is incomplete');
  return {ok,errors,messages,report};
}
function contactSheet(dir,motion,options={}) {
  const folder=path.join(path.resolve(dir),'sheet-frames');
  const times=Array.from({length:Math.ceil(motion.duration)},(_,i)=>i);
  const {status}=runHF(['snapshot',path.resolve(dir),'--at',times.join(','),'--no-end','--output',folder,'--json'],options.run);
  if(status!==0)throw new Error('HyperFrames snapshot failed');
  const files=fs.readdirSync(folder).filter(f=>/at-[\d.]+s\.png$/.test(f)).sort((a,b)=>Number(a.match(/at-([\d.]+)s/)[1])-Number(b.match(/at-([\d.]+)s/)[1]));
  if(files.length!==times.length)throw new Error(`expected ${times.length} 1 fps frames, got ${files.length}`);
  files.forEach((f,i)=>fs.copyFileSync(path.join(folder,f),path.join(folder,`sheet-${String(i).padStart(5,'0')}.png`)));
  const out=path.join(path.resolve(dir),'contact-sheet.png'),cols=Math.min(5,files.length),rows=Math.ceil(files.length/cols);
  const result=(options.run||spawnSync)('ffmpeg',['-v','error','-y','-framerate','1','-i',path.join(folder,'sheet-%05d.png'),'-vf',`scale=384:-2,tile=${cols}x${rows}:nb_frames=${files.length}:padding=8:margin=8:color=0x20242b`,'-frames:v','1',out],{encoding:'utf8'});
  if(result.status!==0)throw new Error(`contact sheet failed: ${result.error?.message||result.stderr}`);
  return out;
}
module.exports={checkProject,mapFinding,contactSheet,runHF};
