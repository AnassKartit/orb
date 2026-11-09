#!/usr/bin/env node
// Render an Orb page to MP4: seek frame by frame (every frame is a pure function of time), pipe PNG/JPEG frames to ffmpeg.
// usage: render.js <page.html> -o out.mp4 [--from 0] [--to 10] [--fps 24] [--scale 1]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const a = process.argv.slice(2), opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
(async () => {
  const file = a.find(x => !x.startsWith('-')), out = opt('-o', 'out.mp4');
  const from = +opt('--from', 0), to = +opt('--to', 0), fps = +opt('--fps', 24), scale = +opt('--scale', 1);
  const fs = require('fs');
  const sys = process.env.ORB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  let browser;
  try { browser = await chromium.launch(launch); }
  catch (e) { if (!fs.existsSync(sys)) throw e; browser = await chromium.launch({ ...launch, executablePath: sys, headless: true }); }   // no bundled browser: use the installed Chrome
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  await page.goto('file://' + path.resolve(file) + '?controls=0'); await page.waitForTimeout(600);
  const dur = await page.evaluate(() => window.__PRISM_DURATION__);
  const end = to || dur, n = Math.round((end - from) * fps);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => { window.pause && window.pause(); window.seek(t); }, from + i / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 60 === 0) process.stderr.write(`frame ${i}/${n}\r`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await browser.close();
  console.log(`rendered ${n} frames (${(end - from).toFixed(1)} s at ${fps} fps) in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
})();
