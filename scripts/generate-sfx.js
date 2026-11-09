// Original synthetic sounds, dedicated to CC0. No recordings or samples.
const {spawnSync}=require('child_process');
const path=require('path');
const sounds={
  whoosh:['anoisesrc=color=white:amplitude=0.25:seed=42:duration=0.45','highpass=f=500,lowpass=f=4500,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.27'],
  pop:['sine=frequency=180:duration=0.16','afade=t=out:d=0.16,volume=0.7'],
  ping:['sine=frequency=1400:duration=0.6','afade=t=out:d=0.6,volume=0.35'],
  click:['anoisesrc=color=white:amplitude=0.3:seed=7:duration=0.08','highpass=f=2000,afade=t=out:d=0.08'],
  riser:['aevalsrc=0.2*sin(2*PI*(180*t+900*t*t)):d=1.5','afade=t=in:d=1.3,afade=t=out:st=1.3:d=0.2']
};
for(const [name,[src,filter]] of Object.entries(sounds)) {
  const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',src,'-af',filter,'-ar','44100','-ac','1','-c:a','pcm_s16le',path.join(__dirname,'../assets/sfx',name+'.wav')],{stdio:'inherit'});
  if(r.status!==0) process.exit(r.status||1);
}
