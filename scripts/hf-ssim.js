#!/usr/bin/env node
// Compare matching HyperFrames snapshot envelopes using FFmpeg, without resizing.
const fs = require('fs');
const {spawnSync} = require('child_process');
const [reference, candidate, output] = process.argv.slice(2);
if (!reference || !candidate) throw Error('usage: node scripts/hf-ssim.js reference.json candidate.json [result.json]');
const a = JSON.parse(fs.readFileSync(reference)), b = JSON.parse(fs.readFileSync(candidate));
function dimensions(file) {
  const png = fs.readFileSync(file);
  if (png.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw Error(`not a PNG: ${file}`);
  return [png.readUInt32BE(16),png.readUInt32BE(20)];
}
const rows = a.frames.map(frame => {
  const other = b.frames.find(f => f.time === frame.time);
  if (!other) throw Error(`missing candidate frame at ${frame.time}`);
  if (String(dimensions(frame.path)) !== String(dimensions(other.path))) throw Error(`frame sizes differ at ${frame.time}`);
  const r = spawnSync('ffmpeg', ['-i',frame.path,'-i',other.path,'-lavfi','ssim','-f','null','-'], {encoding:'utf8'});
  const match = r.stderr.match(/All:([\d.]+)/);
  if (r.status || !match) throw Error(r.stderr);
  return {time:frame.time,ssim:Number(match[1])};
});
const sorted=rows.map(r=>r.ssim).sort((x,y)=>x-y), n=sorted.length;
const result={rows,median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,min:sorted[0]};
if(output) fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
