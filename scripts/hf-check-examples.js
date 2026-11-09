#!/usr/bin/env node
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const {build}=require('../src/hf');
const root=path.resolve(process.argv[2]||'out/hf/parity/checks'); fs.mkdirSync(root,{recursive:true});
const rows=[];
for(const file of fs.readdirSync('examples/hf').filter(f=>f.endsWith('.orb')).sort()){
 const name=path.basename(file,'.orb'),dir=path.join(root,'builds',name);
 try {
  build(fs.readFileSync(path.join('examples/hf',file),'utf8'),dir,{baseDir:path.resolve('examples/hf')});
  const run=spawnSync('npx',['--no-install','hyperframes','check',dir,'--json'],{encoding:'utf8',env:{...process.env,HF_WORKERS:'1'},maxBuffer:10*1024*1024});
  fs.writeFileSync(path.join(root,name+'.json'),run.stdout);fs.writeFileSync(path.join(root,name+'.stderr'),run.stderr);
  const report=JSON.parse(run.stdout);
  const errors=Object.values(report).flatMap(x=>x?.findings||[]).filter(x=>x.severity==='error').length;
  rows.push({name,ok:report.ok,browserSkipped:report.browserSkipped,errors,exit:run.status});
 }catch(e){rows.push({name,ok:false,error:e.message});}
 console.log(JSON.stringify(rows.at(-1)));
 fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(rows,null,2)+'\n');
}
if(rows.some(r=>!r.ok||r.browserSkipped||r.errors||r.exit))process.exitCode=1;
