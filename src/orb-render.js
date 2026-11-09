// orb render file.orb out.mp4 [1080|2K|4K] [9x16|16x9|1x1|4x5] [--fps 30] [--draft] [--fit cover|contain] [--focus 0.5]
// Builds the .orb into a HyperFrames project, renders it with the HyperFrames CLI at the asked resolution,
// and reframes to another aspect with ffmpeg when the asked aspect differs from the file's own.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { build } = require('./hf');

const SIZES = { '1080': 'base', '1080p': 'base', 'hd': 'base', '2k': '1440p', '1440': '1440p', '1440p': '1440p', 'qhd': '1440p', '4k': '4k', '2160': '4k', '2160p': '4k', 'uhd': '4k' };
const SHORT_SIDE = { base: 1080, '1440p': 1440, '4k': 2160 };
const ASPECTS = { '9x16': [9, 16], '16x9': [16, 9], '1x1': [1, 1], '4x5': [4, 5], '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5] };
const even = n => Math.round(n / 2) * 2;

function parseArgs(args) {
  const o = { size: 'base', aspect: null, fps: null, draft: false, fit: 'cover', focus: 0.5, files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i], k = a.toLowerCase();
    if (k === '--fps') o.fps = args[++i];
    else if (k === '--draft') o.draft = true;
    else if (k === '--fit') o.fit = args[++i];
    else if (k === '--focus') o.focus = +args[++i];
    else if (SIZES[k]) o.size = SIZES[k];
    else if (ASPECTS[k]) o.aspect = ASPECTS[k];
    else if (a.startsWith('-')) throw new Error(`unknown option '${a}'`);
    else o.files.push(a);
  }
  if (o.files.length !== 2) throw new Error('usage: orb render file.orb out.mp4 [1080|2K|4K] [9x16|16x9|1x1|4x5] [--fps 30] [--draft] [--fit cover|contain] [--focus 0..1]');
  if (!['cover', 'contain'].includes(o.fit)) throw new Error("--fit must be 'cover' or 'contain'");
  if (!(o.focus >= 0 && o.focus <= 1)) throw new Error('--focus must be between 0 and 1');
  return o;
}

function hfPreset(w, h, size) {
  const orient = w > h ? 'landscape' : w < h ? 'portrait' : 'square';
  if (size === 'base') return orient;
  return `${orient}-${size}`;
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, HF_WORKERS: process.env.HF_WORKERS || '1', ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] || ''} failed (exit ${r.status})`);
}

// Player files (.prism, or .orb with scene blocks): decks, charts, diagrams, characters. Frame-by-frame in Chrome, then audio mixed in.
function renderPlayer(o, src, out) {
  const { compile, parse } = require('./prism');
  const source = fs.readFileSync(src, 'utf8'), base = path.dirname(src);
  const page = out.replace(/\.\w+$/, '.page.html'), silent = out.replace(/\.\w+$/, '.silent.mp4');
  fs.writeFileSync(page, compile(source, { baseDir: base }));
  const m = parse(source), scale = { base: 1.5, '1440p': 2, '4k': 3 }[o.size];   // player pages are 1280 wide
  run('node', [path.join(__dirname, 'render.js'), page, '-o', silent, '--fps', String(o.fps || 30), '--scale', String(scale * 1280 / m.w)]);
  const clips = [];
  const walk = (els, t0) => els.forEach(e => {
    const file = e.type === 'audio' ? e.text[0] : (e.type === 'act' && e.named.audio) ? e.named.audio : null;
    const vol = e.named.volume !== undefined ? +e.named.volume : 1;
    if (file && vol > 0) clips.push({ file: path.resolve(base, file), at: t0 + e.at, vol });
    if (e.children) walk(e.children, t0);
  });
  m.scenes.forEach(sc => walk(sc.els, sc.start));
  const final = (o.aspect ? out.replace(/(\.\w+)$/, '.native$1') : out);
  if (!clips.length) fs.renameSync(silent, final);
  else {
    const ins = clips.flatMap(c => ['-i', c.file]);
    const f = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}:all=1,volume=${c.vol}[a${i}]`).join(';') + ';' + clips.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${clips.length}:normalize=0[a]`;
    run('ffmpeg', ['-v', 'error', '-y', '-i', silent, ...ins, '-filter_complex', f, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', final]);
    fs.rmSync(silent, { force: true });
  }
  fs.rmSync(page, { force: true });
  return final;
}

function render(args) {
  const o = parseArgs(args);
  const [src, out] = o.files.map(f => path.resolve(f));
  if (/\.prism$/.test(src) || /^\s+scene\b/m.test(fs.readFileSync(src, 'utf8'))) {
    const made = renderPlayer(o, src, out);
    if (o.aspect) reframe(o, made, out, null);
    console.log(`rendered ${out}`); return out;
  }
  const work = path.join(path.dirname(out), `.orb-build-${path.basename(out, path.extname(out))}`);
  const m = build(fs.readFileSync(src, 'utf8'), work, { baseDir: path.dirname(src) });
  const same = !o.aspect || Math.abs(o.aspect[0] / o.aspect[1] - m.width / m.height) < 0.01;
  const native = same ? out : out.replace(/(\.\w+)$/, '.native$1');
  const hf = ['hyperframes', 'render', work, '-o', native, '--resolution', hfPreset(m.width, m.height, o.size), '-q', o.draft ? 'draft' : 'delivery'];
  hf.push('--workers', String(process.env.HF_WORKERS || 1));   // one Chrome per worker; the CLI ignores the environment variable
  if (o.fps) hf.push('--fps', String(o.fps));
  run('npx', hf);
  if (!same) reframe(o, native, out, m);
  console.log(`rendered ${out}`);
  return out;
}

function reframe(o, native, out) {
  {
    const [aw, ah] = o.aspect, side = SHORT_SIDE[o.size];
    const W = even(aw <= ah ? side : side * aw / ah), H = even(aw <= ah ? side * ah / aw : side);
    const vf = o.fit === 'cover'
      ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})*${o.focus}:(ih-${H})/2`
      : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`;
    run('ffmpeg', ['-v', 'error', '-y', '-i', native, '-vf', `${vf},setsar=1`, '-c:v', 'libx264', '-crf', o.draft ? '23' : '16', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
    fs.rmSync(native, { force: true });
  }
}

module.exports = { render, parseArgs, hfPreset };

// orb preview file.orb [--port 3002]: build into a sibling folder and open the HyperFrames Studio preview on it.
function preview(args) {
  const file = args.find(a => !a.startsWith('-'));
  if (!file) throw new Error('usage: orb preview file.orb [--port 3002]');
  const src = path.resolve(file), work = path.join(path.dirname(src), `.orb-preview-${path.basename(src, '.orb')}`);
  const m = build(fs.readFileSync(src, 'utf8'), work, { baseDir: path.dirname(src) });
  console.log(`built ${work} (${m.width}x${m.height}, ${m.duration}s); opening preview`);
  const pi = args.indexOf('--port');
  run('npx', ['hyperframes', 'preview', work, ...(pi >= 0 ? ['--port', args[pi + 1]] : [])]);
}
module.exports.preview = preview;
