#!/usr/bin/env node
// Parity of the web target against the video renderer.
// For each file: build the project, take three reference frames with `hyperframes snapshot`, build the web page,
// screenshot it in Chrome at the same times after window.seek(t), and compare each pair with ffmpeg's SSIM.
// It also seeks back to the first time and checks that the page is in the same state (every inline style and text)
// and shows the same picture.
//   node scripts/web-parity.js [file.orb ...]        exit 1 when a frame is under the target
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const web = require('../src/web');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGET = 0.95;
const DEFAULT_FILES = ['examples/std/short-demo.orb', 'examples/std/charts-demo.orb', 'examples/hf/text.orb', 'examples/hf/to.orb',
  'examples/hf/group.orb', 'examples/hf/count.orb', 'examples/hf/karaoke.orb', 'examples/hf/nesting.orb'];

function ssim(a, b) {
  const r = spawnSync('ffmpeg', ['-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const match = r.stderr.match(/All:([\d.]+)/);
  if (r.status || !match) throw new Error(`ffmpeg ssim failed for ${a}: ${r.stderr.slice(-400)}`);
  return Number(match[1]);
}

async function main() {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const rows = [];
  for (const file of files) {
    const source = path.resolve(ROOT, file), name = path.basename(file, '.orb'), dir = path.join(ROOT, 'out/hf/web-parity', name);
    fs.rmSync(dir, { recursive: true, force: true });
    const { html, motion } = web.build(fs.readFileSync(source, 'utf8'), { workDir: dir, baseDir: path.dirname(source), sourceFile: source });
    fs.writeFileSync(path.join(dir, 'web.html'), html);
    const times = [.2, .5, .8].map(k => Math.round(motion.duration * k * 100) / 100);

    // One reference job at a time.
    const shot = spawnSync('npx', ['--no-install', 'hyperframes', 'snapshot', dir, '--at', times.join(','), '--no-end', '--output', path.join(dir, 'snap'), '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, HF_WORKERS: '1' } });
    let reference;
    try { reference = JSON.parse(shot.stdout.slice(shot.stdout.indexOf('{'))).frames; } catch { throw new Error(`snapshot failed for ${file}: ${(shot.stderr || shot.stdout).slice(-600)}`); }

    const page = await browser.newPage({ viewport: { width: motion.width, height: motion.height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(path.join(dir, 'web.html')).href + '?controls=0&t=0');
    await page.waitForFunction(() => typeof window.seek === 'function', null, { timeout: 30000 });
    const frame = async (t, out) => {
      await page.evaluate(time => window.seek(time), t);
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      return page.screenshot({ path: out });
    };
    const state = () => page.evaluate(() => [...document.querySelectorAll('#root *')].map(el => el.style.cssText + '|' + (el.children.length ? '' : el.textContent)).join('\n'));
    let firstState;
    for (const [i, t] of times.entries()) {
      const out = path.join(dir, 'web', `frame-${i}-at-${t}s.png`);
      await frame(t, out);
      if (!i) firstState = await state();
      rows.push({ file, t, ssim: ssim(reference.find(f => f.time === t).path, out) });
    }
    await frame(times[0], path.join(dir, 'web', 'frame-0-again.png'));
    rows.at(-1).pure = await state() === firstState && ssim(path.join(dir, 'web', `frame-0-at-${times[0]}s.png`), path.join(dir, 'web', 'frame-0-again.png')) >= 0.99999;
    rows.at(-1).errors = errors;
    await page.close();
  }
  await browser.close();

  console.log('file'.padEnd(32) + 't'.padStart(6) + 'SSIM'.padStart(10));
  for (const r of rows) {
    console.log(r.file.padEnd(32) + String(r.t).padStart(6) + r.ssim.toFixed(4).padStart(10) + (r.ssim < TARGET ? '  UNDER TARGET' : '')
      + (r.pure === undefined ? '' : r.pure ? '  seek back: same state and picture' : '  seek back: DIFFERENT') + (r.errors?.length ? `  page errors: ${r.errors.join(' | ')}` : ''));
  }
  const worst = Math.min(...rows.map(r => r.ssim));
  console.log(`\n${rows.length} frames, lowest SSIM ${worst.toFixed(4)}, target ${TARGET}`);
  fs.writeFileSync(path.join(ROOT, 'out/hf/web-parity/result.json'), JSON.stringify(rows, null, 2) + '\n');
  if (worst < TARGET || rows.some(r => r.pure === false || r.errors?.length)) process.exit(1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
