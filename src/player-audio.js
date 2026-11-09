const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Fixed PCM format and integer RMS windows: no timestamps, random IDs or runtime FFT.
function decode(file, line, ErrorType) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', file, '-vn', '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new ErrorType(line, `cannot decode audio '${path.basename(file)}'; install ffmpeg and use a decodable local audio file (${result.error?.message || String(result.stderr).trim()})`);
  const pcm = result.stdout, samples = Math.floor(pcm.length / 4), rms = [];
  if (!samples) throw new ErrorType(line, 'audio file contains no samples');
  for (let i = 0; i < samples; i += 800) {
    let sum = 0, end = Math.min(samples, i + 800);
    for (let j = i; j < end; j++) { const value = pcm.readFloatLE(j * 4); sum += value * value; }
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const peak = rms.reduce((max, r) => Math.max(max, r), 0);
  return { duration: samples / 24000, fps: 30, envelope: Buffer.from(rms.map(r => peak > 0 ? Math.round(255 * r / peak) : 0)).toString('base64') };
}
function prepare(motion, baseDir, ErrorType) {
  const assets = {}, byFile = new Map(), clips = [];
  function media(el, start, end, state = false) {
    if (el.type === 'act' && el.named.text !== undefined) motion.playerTalk = true;
    const name = el.type === 'audio' ? el.text[0] : el.type === 'act' ? el.named.audio : null;
    if (name === null || name === undefined) return;
    if (/^[a-z]+:/i.test(name)) throw new ErrorType(el.line, 'audio needs a local file, e.g. audio "assets/line.wav"');
    const file = path.resolve(baseDir, name);
    if (!fs.existsSync(file)) throw new ErrorType(el.line, `audio '${name}' not found (use a path relative to the .prism file)`);
    let id = byFile.get(file);
    if (!id) {
      id = 's' + byFile.size;
      const data = decode(file, el.line, ErrorType);
      const mime = { wav: 'wav', mp3: 'mpeg', m4a: 'mp4', ogg: 'ogg', flac: 'flac', aac: 'aac' }[path.extname(file).slice(1).toLowerCase()] || 'mpeg';
      assets[id] = { ...data, src: `data:audio/${mime};base64,${fs.readFileSync(file).toString('base64')}` };
      byFile.set(file, id);
    }
    el.audio = id;
    if (el.autoDuration) { el.dur = assets[id].duration; delete el.autoDuration; }
    if (!state) clips.push({ audio: id, at: start + el.at, end: Math.min(end, start + el.at + el.dur), dur: el.dur, volume: Number(el.named.volume ?? 1) });
  }
  for (const sc of motion.scenes) {
    const walk = (els, start) => els.filter(el => {
      media(el, start, sc.end);
      if (el.children) el.children = walk(el.children, el.type === 'stage' || el.type === 'world' ? start + el.at : start);
      return el.type !== 'audio';
    });
    sc.els = walk(sc.els, sc.start);
  }
  for (const m of motion.interactive?.machines || []) for (const state of m.states) {
    for (const a of state.actions) media(a, 0, Infinity, true);
    state.duration = Math.max(...state.actions.map(a => a.at + a.dur));
  }
  if (byFile.size) { motion.audioAssets = assets; motion.audioClips = clips; }
}
module.exports = { prepare, decode };
