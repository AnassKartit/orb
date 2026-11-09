const fs=require('fs'),path=require('path');
function distance(a,b) {
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]!==b[j-1]));prev=old;}}
  return row[b.length];
}
function resolver(base,assets,fail) {
  const roots=[...new Set([path.resolve(base,assets),base,...(process.env.ORB_ASSETS||'').split(path.delimiter).filter(Boolean).flatMap(p=>[p,path.join(p,'fonts'),path.join(p,'sfx')]),path.join(__dirname,'../assets/sfx')].map(p=>path.resolve(p)))];
  return (ref,line,relative)=>{
    const clean=String(ref).replace(/[?#].*$/,'');
    const dirs=[...new Set([...roots,...(relative?[relative]:[])])];
    const candidates=dirs.map(d=>path.resolve(d,clean));
    // Sound extensions are interchangeable only for the bundled original synths.
    const stem=path.basename(clean).replace(/\.(mp3|wav|ogg|m4a)$/i,'');
    if(['whoosh','pop','ping','click','riser'].includes(stem) && !clean.includes('/')) candidates.push(path.join(__dirname,'../assets/sfx',stem+'.wav'));
    for(const f of candidates) if(fs.existsSync(f)&&fs.statSync(f).isFile()) return f;
    const names=[];
    for(const dir of [...new Set(dirs.flatMap(d=>[path.resolve(d,path.dirname(clean)),d]))]) {try{for(const entry of fs.readdirSync(dir,{withFileTypes:true})) if(entry.isFile()) names.push(entry.name);}catch{}}
    const closest=[...new Set(names)].sort((a,b)=>distance(a.toLowerCase(),path.basename(clean).toLowerCase())-distance(b.toLowerCase(),path.basename(clean).toLowerCase()))[0];
    fail(line,`asset '${ref}' not found; searched: ${dirs.join(', ')}${closest?`; did you mean '${closest}'?`:''}`);
  };
}
module.exports={resolver};
