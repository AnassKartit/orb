#!/usr/bin/env node
// Render still frames of an animation page for inspection: shot.js <file.html> <outdir> <t1,t2,...>
// Works on Orb output (window.seek), GSAP pages (global `tl`) and plain CSS-animation pages (seeks every animation).
const { chromium } = require(process.env.PW || 'playwright-core');
const path = require('path');
const fs = require('fs');
(async () => {
  const [file, outDir, times] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const url = file.startsWith('http') ? file : 'file://' + path.resolve(file);
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'controls=0' + (process.env.XQ ? '&' + process.env.XQ : ''), { waitUntil: 'load' });
  await page.waitForTimeout(600);
  if (process.env.LIVE) {   // real-time capture for pages whose timeline we cannot seek
    await page.goto(url + (url.includes('?') ? '&' : '?') + 'controls=0', { waitUntil: 'load' });
    const t0 = Date.now();
    for (const t of times.split(',').map(Number)) {
      const wait = t * 1000 - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.screenshot({ path: path.join(outDir, `t${t}.png`) });
    }
    console.log(JSON.stringify({ errors }));
    await browser.close();
    return;
  }
  for (const t of times.split(',').map(Number)) {
    await page.evaluate((t) => {
      if (window.seek) { if (window.pause) window.pause(); window.seek(t); return; }
      if (typeof tl !== 'undefined') { tl.pause(); tl.seek(t); return; }
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = t * 1000; });
      const n = document.getElementById('num');
      if (n) { const p = Math.min(1, Math.max(0, (t - 3) / 1.6)); n.textContent = '$' + (1.2 * (1 - Math.pow(1 - p, 3))).toFixed(1) + 'M'; }
    }, t);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `t${t}.png`) });
  }
  console.log(JSON.stringify({ errors }));
  await browser.close();
})();
