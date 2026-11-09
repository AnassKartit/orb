#!/usr/bin/env node
// Smoke test of the playground, opened from file:// in Chrome at 1280x720 (and once at phone width).
// It walks through Learn Orb, loads every sample, and checks each feature on the live page: looping, slideshow
// keys, replay after an edit, colour swatches, media chips, drop, add image or video, error display, export,
// record (button and fallback message only), the footer commands, the share link and the phone layout.
//   node scripts/playground-smoke.js [--shots folder]        exit 1 on the first failure
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = pathToFileURL(path.join(ROOT, 'playground', 'index.html')).href;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const SAMPLES = [/^Swap the image and the colours \((\d+) lines\)$/, /^3 lines: animated title$/, /^5 lines: counter and bar chart$/, /^12 lines: data video$/,
  /^14 lines: interactive character, hover and click it$/, /^Presentation \((\d+) lines\)$/, /^Chart written in Orb \((\d+) lines\)$/, /^Kinetic captions \((\d+) lines\)$/];
const TAGLINE = 'A small language AI models write to make videos, decks and interactive animations';
const INSTALL = 'git clone https://github.com/AnassKartit/orb.git && cd orb && npm install';
const AGENT = 'claude mcp add orb -- node /path/to/orb/src/mcp.js';

function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) throw new Error(what);
}
// A plain PNG of one colour that no sample uses, so it can be found in the preview.
function png(side, colour) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(side, 0); header.writeUInt32BE(side, 4); header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array.from({ length: side }, () => colour).flat()]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(side).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const builds = () => page.evaluate(() => Number(document.body.dataset.builds || 0));
  const nextBuild = before => page.waitForFunction(n => Number(document.body.dataset.builds || 0) > n, before);
  const onScreen = () => page.waitForFunction(() => document.body.dataset.shown === document.body.dataset.builds);   // the last build is the page in front
  const edit = async text => { const before = await builds(); await page.fill('#source', text); await nextBuild(before); };
  const choose = async i => { const before = await builds(); await page.selectOption('#samples', String(i)); await nextBuild(before); await onScreen(); };
  const sourceText = () => page.inputValue('#source');
  const frame = async () => {
    const inner = await (await page.$('#preview')).contentFrame();
    await inner.waitForFunction(() => typeof window.seek === 'function', null, { timeout: 30000 });
    return inner;
  };
  const clock = async () => parseFloat(await (await frame()).evaluate(() => (document.querySelector('#clock, #orb-bar span') || {}).textContent || ''));
  const slide = async () => (await frame()).evaluate(() => window.__PRISM_PRESENT__().cur);
  // What the stage shows (the preview without its control bar): `content` is the share of pixels that stand out
  // from the most common brightness (an empty or softly shaded stage has none); the rest are shares of one colour.
  const stage = async (on = page) => {
    const box = await on.locator('#frames').boundingBox();
    const shot = await on.screenshot({ clip: { ...box, height: box.height - 56 } });
    return on.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data, luma = [], bins = new Array(256).fill(0);
      const count = { magenta: 0, green: 0, cyan: 0 };
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]], y = Math.round(.2126 * r + .7152 * g + .0722 * b);
        luma.push(y); bins[y]++;
        if (r > 200 && g < 80 && b > 200) count.magenta++;
        if (r < 80 && g > 200 && b < 80) count.green++;
        if (r < 80 && g > 200 && b > 200) count.cyan++;
      }
      const common = bins.indexOf(Math.max(...bins)), share = n => n / luma.length;
      return { content: share(luma.filter(y => Math.abs(y - common) > 80).length), magenta: share(count.magenta), green: share(count.green), cyan: share(count.cyan) };
    }, 'data:image/png;base64,' + shot.toString('base64'));
  };
  const percent = share => `${(share * 100).toFixed(1)}%`;
  const exported = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
    return { name: download.suggestedFilename(), html: fs.readFileSync(await download.path(), 'utf8') };
  };
  // Every reference in a page must be inside it (data:) or on the web (https:). "${" is the player's own code
  // putting a URL together, not a reference.
  const outside = html => [...html.matchAll(/(?<![\w-])(?:src|href)=["']([^"']+)["']|url\(\s*["']?([^)"'\s]+)/g)].map(m => m[1] || m[2]).filter(ref => !/^(?:https:|data:|#|\$\{)/.test(ref));
  const pickFile = async (trigger, file) => { const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(trigger)]); await chooser.setFiles(file); };
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } };

  await page.goto(PAGE);
  await page.waitForFunction(() => Number(document.body.dataset.builds || 0) > 0);
  await onScreen();

  // ---------- first view: finished look, Learn Orb open ----------
  check(await page.textContent('h1') === 'Orb' && (await page.textContent('header')).includes(TAGLINE), `header: Orb, "${TAGLINE}"`);
  const fits = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth <= innerWidth, tall: document.documentElement.scrollHeight <= innerHeight,
    editor: document.getElementById('editor').offsetHeight, preview: document.getElementById('frames').offsetHeight }));
  check(fits.wide && fits.tall && fits.editor >= 200 && fits.preview >= 380, `at 1280x720 the page fits without scrolling (editor ${fits.editor} px, preview ${fits.preview} px tall)`);
  check(await page.isVisible('#lesson') && await page.textContent('#lesson-count') === 'Step 1 of 9', 'with no link, the playground opens on Learn Orb, Step 1 of 9');
  await shot('01-learn');

  // ---------- Learn Orb: nine steps, each with one change, a tick and Show me ----------
  const steps = await page.evaluate(() => ORB_LESSONS.length);
  for (let i = 0; i < steps; i++) {
    const title = await page.textContent('#lesson-title');
    check(await page.textContent('#lesson-count') === `Step ${i + 1} of ${steps}` && !(await page.isVisible('#lesson-done')) && !(await page.isVisible('#problem')), `step ${i + 1} "${title}": loads a file that compiles, not ticked yet`);
    if (i === 1) check(await page.$eval('#palette', el => el.classList.contains('point')) && await page.textContent('.swatch') === '#7c5cff', 'step 2 points at the accent swatch #7c5cff');
    let before = await builds();
    await page.click('#lesson-show');
    await nextBuild(before);
    await onScreen();
    check(!(await page.isVisible('#problem')) && await page.isVisible('#lesson-done') && await page.evaluate(n => ORB_LESSONS[n].done(document.getElementById('source').value), i), `step ${i + 1}: Show me makes the change, the file compiles and the step is ticked`);
    await page.waitForTimeout(900);
    const seen = await stage();
    check(seen.content > .002, `step ${i + 1}: the preview plays the result (${percent(seen.content)} of the stage stands out)`);
    if (i === 5) {   // the two slide deck: keys reach it without a click inside the preview
      check(await page.isVisible('#hint') && await page.textContent('#hint') === 'click or use the arrow keys', 'step 6: the slideshow shows the hint "click or use the arrow keys"');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      check(await slide() === 1 && !(await page.isVisible('#hint')), 'step 6: the right arrow, pressed on the page, moves to slide 2 and the hint goes away');
    }
    await shot(`02-step-${i + 1}`);
    before = await builds();
    await page.click('#lesson-next');
    if (i < steps - 1) { await nextBuild(before); await onScreen(); }
  }
  check((await page.textContent('#lesson-say')) === 'You now know Orb. Open the samples or start from an empty file.' && await page.isVisible('#lesson-samples') && await page.isVisible('#lesson-empty'), 'after step 9: "You now know Orb. Open the samples or start from an empty file."');
  await page.click('#lesson-back');
  await onScreen();
  check(await page.textContent('#lesson-count') === `Step ${steps} of ${steps}` && await page.isVisible('#lesson-done') && /c\.bars \[12, 18, 9, 24\]/.test(await sourceText()), 'Back returns to step 9 with the visitor\'s file and its tick');
  await page.click('#lesson-next');

  // ---------- empty state ----------
  let before = await builds();
  await page.click('#lesson-empty');
  await nextBuild(before);
  check(await page.isVisible('#empty') && (await page.textContent('#empty')).includes('Nothing to play yet') && !(await page.isVisible('#problem')) && await page.isDisabled('#export') && (await page.textContent('#size')).startsWith('0 lines'),
    'an empty file shows "Nothing to play yet" over the preview, with no error');
  before = await builds();
  await page.click('#empty-start');
  await nextBuild(before);
  await onScreen();
  check(!(await page.isVisible('#empty')) && /title "Hello, Orb"/.test(await sourceText()), 'Start with three lines fills the editor and plays');

  before = await builds();
  await page.click('#learn');
  await nextBuild(before);
  check(await page.isVisible('#lesson') && await page.textContent('#lesson-count') === 'Step 1 of 9', 'the Learn Orb button in the header opens the tutorial again');

  // ---------- samples menu, line counts ----------
  const titles = (await page.$$eval('#samples option', options => options.map(o => o.textContent))).slice(1);
  check(titles.length === SAMPLES.length && SAMPLES.every((expected, i) => expected.test(titles[i])), `samples menu, in order: ${titles.join(' | ')}`);
  for (const [i, title] of titles.entries()) {
    errors.length = 0;
    await choose(i);
    check(!(await page.isVisible('#problem')) && !(await page.isVisible('#lesson')), `${title}: builds without an error`);
    const lines = (await sourceText()).split('\n').filter(line => line.trim()).length, size = await page.textContent('#size');
    check(Number(title.match(/(\d+) lines/)[1]) === lines && size.startsWith(`${lines} lines, `) && /bytes, about [\d,]+ tokens \(bytes \/ 4, estimate\)/.test(size), `${title}: the name and the live counter both say ${lines} lines ("${size}")`);
    await frame();
    await page.waitForTimeout(1200);
    const seen = await stage();
    check(seen.content > .002, `${title}: preview shows content (${percent(seen.content)} of the stage stands out)`);
    if (/^Presentation/.test(title)) {
      check(await page.isVisible('#hint') && await (await frame()).evaluate(() => window.__PRISM_STOPS__.length) === 6, `${title}: 6 slides, and the hint "click or use the arrow keys" is on the preview`);
      await page.waitForTimeout(5500);   // longer than a slide: a slideshow must wait for the visitor
      check(await slide() === 0, `${title}: it does not advance by itself (still on slide 1 after 6.7 s)`);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const byKey = await slide();
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(200);
      const back = await slide();
      await page.locator('#preview').click({ position: { x: 300, y: 200 } }); await page.locator('#preview').click({ position: { x: 300, y: 200 } });
      await page.waitForTimeout(200);
      check(byKey === 1 && back === 0 && await slide() === 1 && !(await page.isVisible('#hint')), `${title}: arrow keys work without clicking inside the preview (right: slide ${byKey + 1}, left: slide ${back + 1}); a click moves on too; the hint is gone`);
    }
    if (/interactive character/.test(title)) check(await (await frame()).evaluate(() => typeof window.orb.fire === 'function' && typeof window.orb.set === 'function'), `${title}: the character answers to hover and click (orb.set, orb.fire)`);
    check(errors.length === 0, `${title}: no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await shot(`03-sample-${i + 1}`);
  }
  errors.length = 0;

  // ---------- looping: a preview never sits on its last frame ----------
  for (const [what, load, length] of [['a page with scenes (3 line sample, 4 s)', () => choose(1), 4], ['a video page (2 s)', async () => { await edit('motion "Tiny" 640x360 2s\n  rect at=0 dur=2 color=#176b65\n  text "Loop" at=0 dur=2 box=70,110,500,120 size=54 align=center in=rise\n'); await onScreen(); }, 2]]) {
    await load();
    const started = Date.now();
    await page.waitForTimeout((length + 2) * 1000);
    const time = await clock(), seen = await stage();
    check(time < length - .5 && seen.content > .002, `${what}: ${((Date.now() - started) / 1000).toFixed(1)} s after it loaded (its length plus 2 s) the clock is back at ${time}s and the stage is not empty (${percent(seen.content)})`);
  }

  // ---------- change one thing, it replays ----------
  await choose(3);   // the 10 second data video
  await (await frame()).waitForFunction(() => parseFloat(document.querySelector('#clock').textContent) >= 2);
  const started = Date.now();
  before = await builds();
  await page.fill('#source', (await sourceText()).replace('Launch Week', 'Launch Day'));
  await nextBuild(before);
  const waited = Date.now() - started;
  await onScreen();
  const restart = await clock();
  await page.waitForTimeout(700);
  const later = await clock();
  check(waited >= 290 && waited < 2000 && restart < 1.5 && later > restart, `after an edit the preview rebuilds ${waited} ms later (300 ms debounce) and replays from the start: clock ${restart}s, then ${later}s`);
  check(/LaunchDay/i.test(await (await frame()).evaluate(() => document.getElementById('stage').textContent.replace(/\s/g, ''))), 'the replay shows the edited text');

  // ---------- colour swatches: live, without restarting the clock ----------
  await choose(0);
  const colours = await page.$$eval('.swatch', labels => labels.map(label => label.textContent));
  check(colours.join(' ') === '#0b0f1a #ff2d78 #ffffff #9aa4bf', `one swatch per colour of the source, in source order: ${colours.join(' ')}`);
  await (await frame()).waitForFunction(() => window.currentTime >= 2);
  const beforeDrag = await clock();
  const drag = await page.evaluate(async () => {   // what dragging in the colour picker does: input events, frame after frame
    const input = [...document.querySelectorAll('.swatch')].find(label => label.dataset.colour === '#ff2d78').firstChild, start = performance.now(), count = Number(document.body.dataset.builds);
    input.dragged = true;
    let firstBuild = 0;
    for (const value of ['#22dd22', '#11ee11', '#00ff00']) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (!firstBuild && Number(document.body.dataset.builds) > count) firstBuild = performance.now() - start;
    }
    return { firstBuild, builds: Number(document.body.dataset.builds) - count };
  });
  await onScreen();
  const afterDrag = await clock(), text = await sourceText();
  check(drag.builds === 3 && drag.firstBuild > 0 && drag.firstBuild < 150, `each move of the picker rebuilds at once: 3 builds, the first ${Math.round(drag.firstBuild)} ms after the input (no 300 ms wait)`);
  check(text.split('#00ff00').length - 1 === 3 && !text.includes('#ff2d78') && await page.evaluate(() => [...document.querySelectorAll('.swatch')].some(label => label.firstChild.dragged && label.textContent === '#00ff00')),
    'the colour is replaced in all 3 places of the source, and the swatch being dragged stays in place with its new label #00ff00');
  await page.waitForTimeout(500);
  const seenGreen = await stage(), playingOn = await clock();
  check(afterDrag >= beforeDrag && afterDrag < beforeDrag + 3 && playingOn > afterDrag && seenGreen.green > .003, `the stage shows the new colour (${percent(seenGreen.green)} green) and the clock went on, not back to 0: ${beforeDrag}s before, ${afterDrag}s after, then ${playingOn}s`);
  await page.evaluate(async () => {   // a pick that lands exactly on another colour of the file must not merge the two
    const input = [...document.querySelectorAll('.swatch')].find(label => label.firstChild.dragged).firstChild;
    input.value = '#ffffff';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await onScreen();
  const kept = await page.$$eval('.swatch', labels => labels.map(label => label.textContent));
  check(kept.length === 4 && kept[1] === '#fffffe' && kept[2] === '#ffffff', `picking exactly another colour of the file keeps them apart: ${kept.join(' ')}`);
  await shot('04-colours');

  // ---------- media chips: replace a file under its name, by click and by drop ----------
  await choose(0);
  const chipNames = await page.$$eval('.chip', chips => chips.map(chip => `${chip.dataset.kind} ${chip.textContent}`));
  check(chipNames.join(', ') === 'image placeholder.svg' && !(await page.$eval('.chip', chip => chip.classList.contains('missing'))), `one chip per media file of the source: ${chipNames.join(', ')}`);
  await (await frame()).waitForFunction(() => window.currentTime >= 1.5);
  const beforeSwap = await clock(), sourceBefore = await sourceText(), magenta = png(64, [255, 0, 255]), cyan = png(64, [0, 255, 255]);
  before = await builds();
  await pickFile('.chip', { name: 'holiday photo.png', mimeType: 'image/png', buffer: magenta });
  await nextBuild(before);
  await onScreen();
  await page.waitForTimeout(400);
  const swapped = await stage(), afterSwap = await clock();
  check(swapped.magenta > .05 && await sourceText() === sourceBefore && afterSwap >= beforeSwap, `clicking the chip replaces the file: the stage shows the new picture (${percent(swapped.magenta)} of its colour), the source is unchanged, the clock went on (${beforeSwap}s to ${afterSwap}s)`);
  check(await (await frame()).evaluate(() => document.querySelector('img').src.startsWith('blob:')), 'in the preview the picture is an object URL');
  let file = await exported();
  check(file.html.includes('data:image/png;base64,' + magenta.toString('base64')) && outside(file.html).length === 0, 'in the exported page it is a data URL, with the type of the new file (png under the name placeholder.svg)');
  before = await builds();
  await (await frame()).evaluate(bytes => {   // a file dropped on the preview
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  }, [...cyan]);
  await nextBuild(before);
  await onScreen();
  await page.waitForTimeout(400);
  const droppedOn = await stage();
  check(droppedOn.cyan > .05 && droppedOn.magenta < .001 && await sourceText() === sourceBefore, `a file dropped on the preview replaces the first picture of the source (${percent(droppedOn.cyan)} of the stage is its colour)`);
  await edit(sourceBefore.replace('placeholder.svg', 'not-added.png'));
  check(await page.$eval('.chip', chip => chip.classList.contains('missing')) && /Asset 'not-added\.png' not found\. The playground only has the files you add/.test(await page.textContent('#problem-text')), `a file the playground does not have: its chip is marked and the message says "${await page.textContent('#problem-text')}"`);
  await shot('05-media');

  // ---------- add image or video ----------
  check(await page.textContent('#add-media') === 'Add image or video', 'the button is "Add image or video"');
  const cursorOn = line => page.evaluate(index => {   // put the cursor in the middle of a line
    const el = document.getElementById('source'), at = el.value.split('\n').slice(0, index).join('\n').length + 3;
    el.focus(); el.setSelectionRange(at, at);
  }, line);
  for (const [i, cursor, expectIndex, expectLine] of [
    [7, 6, 8, '  image "my-photo.png" at=0 box=200,200,600,400'],   // video file, cursor on an item that has a child line
    [2, 2, 3, '    image image=my-photo.png'],                      // file with scenes, cursor on an element of the scene
  ]) {
    await choose(i);
    await cursorOn(cursor);
    before = await builds();
    await page.setInputFiles('#media-file', { name: 'my photo.png', mimeType: 'image/png', buffer: magenta });
    await nextBuild(before);
    await onScreen();
    check((await sourceText()).split('\n')[expectIndex] === expectLine && !(await page.isVisible('#problem')), `${titles[i]}: a picture is added as line ${expectIndex + 1}, after the block the cursor is in: ${expectLine.trim()}`);
    await page.waitForTimeout(1500);
    const seen = await stage();
    file = await exported();
    check(seen.magenta > .005 && file.html.includes('data:image/png;base64,' + magenta.toString('base64')) && outside(file.html).length === 0, `${titles[i]}: the preview shows it (${percent(seen.magenta)} of the stage) and the exported page holds it as a data URL`);
  }
  await choose(0);
  await cursorOn(1);
  before = await builds();
  await page.setInputFiles('#media-file', path.join(ROOT, 'examples/hf/assets/sample.mp4'));
  await nextBuild(before);
  await onScreen();
  check((await sourceText()).split('\n')[2] === '  video "sample.mp4" at=0 box=200,200,800,450 fit=cover sound=off' && !(await page.isVisible('#problem')), 'a video is added as: video "sample.mp4" at=0 box=200,200,800,450 fit=cover sound=off');
  await (await frame()).waitForFunction(() => { const video = document.querySelector('video'); return video && video.readyState >= 2 && !video.paused && video.currentTime > .3; }, null, { timeout: 15000 });
  const video = await (await frame()).evaluate(() => { const el = document.querySelector('video'); return { blob: el.src.startsWith('blob:'), time: el.currentTime, clock: window.currentTime, width: el.videoWidth }; });
  check(video.blob && Math.abs(video.time - video.clock) < .5 && video.width > 0 && (await page.$$eval('.chip', chips => chips.map(chip => chip.textContent))).includes('sample.mp4'), `the video plays in step with the clock (video ${video.time.toFixed(2)}s, clock ${video.clock.toFixed(2)}s), from an object URL, and has its own chip`);
  await edit((await sourceText()).replace('sound=off', 'sound=off loop=on'));
  await onScreen();
  const loops = await (await frame()).evaluate(() => document.querySelectorAll('video').length);
  check(!(await page.isVisible('#problem')) && loops >= 2, `loop=on builds without ffprobe: the length comes from the file (${loops} passes of the clip in 6 s)`);
  await choose(1);
  const untouched = await sourceText();
  await page.setInputFiles('#media-file', path.join(ROOT, 'examples/hf/assets/sample.mp4'));
  await page.waitForSelector('#problem:not([hidden])');
  check(await page.textContent('#problem-line') === 'Note' && (await page.textContent('#problem-text')).startsWith('Scenes take images only.') && await sourceText() === untouched, `a video added to a file with scenes: "${await page.textContent('#problem-text')}"`);

  // ---------- Expanded tab ----------
  await choose(7);   // imports the standard library, so its expansion has plain items only
  await page.click('#tab-expanded');
  const expanded = await page.textContent('#expanded');
  check(await page.isVisible('#expanded') && /^motion /m.test(expanded) && /^ {2}text "/m.test(expanded) && !/^\s*s\.\w+/m.test(expanded), 'Expanded tab shows the file with imports and defs written out');
  await page.click('#tab-source');

  // ---------- errors: the line, what is wrong, the suggestion, the line marked in the editor ----------
  await edit('motion "Oops" 640x360 2s\n  rect at=0 color=#176b65\n  tect "typo" at=0 dur=2\n');
  const problem = { line: await page.textContent('#problem-line'), text: await page.textContent('#problem-text'), hint: await page.textContent('#problem-hint') };
  check(await page.isVisible('#problem') && problem.line === 'Line 3' && problem.text === "Unknown word 'tect'." && problem.hint === "Did you mean 'text'?", `a mistake is explained: ${problem.line} | ${problem.text} | ${problem.hint}`);
  const marked = await page.evaluate(() => ({ visible: !document.getElementById('mark').hidden, offset: document.getElementById('mark').getBoundingClientRect().top - document.getElementById('editor').getBoundingClientRect().top, number: document.querySelector('#gutter b').textContent }));
  check(marked.visible && marked.offset === 52 && marked.number === '3' && await page.isDisabled('#export'), 'line 3 is highlighted in the editor and in the gutter, and Export is off while the file has an error');
  await shot('06-error');
  before = await builds();
  await page.click('#problem-fix');
  await nextBuild(before);
  check(!(await page.isVisible('#problem')) && !(await page.isVisible('#mark')) && /^ {2}text "typo"/m.test(await sourceText()) && (await page.textContent('#size')).startsWith('3 lines, '), 'the "Use text" button applies the suggestion: the file compiles and the highlight goes away');
  for (const [what, source, expect] of [
    ['3D', 'motion "3D" 1280x720 4s\n  scene 4s\n    orb color=blue\n', /^Problem\s*3D elements .* not available in the playground/],
    ['icons', 'motion "Icons" 1280x720 4s\n  scene 4s\n    diagram\n      node a "A" icon=firewalls\n      node b "B"\n      edge a -> b\n', /^Line 4\s*Icon 'firewalls' not found\. Icons are not bundled/],
  ]) {
    await edit(source);
    const said = `${await page.textContent('#problem-line')} ${await page.textContent('#problem-text')}`;
    check(expect.test(said), `${what}: "${said}"`);
  }

  // ---------- export ----------
  check(await page.textContent('#render') === 'orb render file.orb out.mp4 1080', 'the MP4 command line is shown next to Export: orb render file.orb out.mp4 1080');
  for (const i of [3, 6]) {   // a file with scenes and a video file
    await choose(i);
    file = await exported();
    const same = await page.evaluate(() => Orb.build(document.getElementById('source').value).html) === file.html;
    check(same && /^<!doctype html>/i.test(file.html) && outside(file.html).length === 0, `${titles[i]}: Export downloads ${file.name} (${(file.html.length / 1024).toFixed(0)} KB), one page with no reference to another file`);
  }

  // ---------- record video ----------
  // A capture needs a person to accept the browser's prompt, so only the button and the message for browsers
  // without screen capture are checked here.
  check(await page.textContent('#record') === 'Record video' && (await page.textContent('#right .bar')).includes('Records in real time. For frame-exact MP4 use the command line.'), 'the Record video button is there, with its label: Records in real time. For frame-exact MP4 use the command line.');
  const plain = await context.newPage();
  await plain.addInitScript(() => { delete window.MediaRecorder; Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); });
  await plain.goto(PAGE);
  await plain.waitForFunction(() => Number(document.body.dataset.builds || 0) > 0);
  await plain.click('#record');
  const refusal = await plain.textContent('#record-status');
  check(refusal === 'Recording needs a Chromium browser; use orb render file.orb out.mp4 1080 for MP4' && await plain.textContent('#record-status code') === 'orb render file.orb out.mp4 1080', `without screen capture, Record video says: "${refusal}"`);
  await plain.close();

  // ---------- footer: install and agent commands ----------
  const footer = await page.textContent('footer');
  check(await page.textContent('#install') === INSTALL && await page.textContent('#agent') === AGENT && footer.includes('Use it from your AI agent') && footer.includes('The MCP server gives a model the cheat sheet plus check, build, expand and render tools.'),
    `footer: ${INSTALL} | ${AGENT}`);
  await page.click('#copy-agent');
  await page.waitForFunction(() => document.getElementById('agent-status').textContent !== '');
  const status = await page.textContent('#agent-status');
  const copied = status === 'Copied' ? await page.evaluate(() => navigator.clipboard.readText()).catch(() => null) : await page.evaluate(() => String(getSelection()));
  check(copied === AGENT, `the Copy button copies the command (${status})`);

  // ---------- share link ----------
  const shared = 'motion "Shared" 640x360 2s\n  text "From a link é" dur=2\n';
  await edit(shared);
  await page.click('#share');
  const link = page.url();
  check(/#src=[\w-]+$/.test(link), `share link stores the source in the hash (${link.length - PAGE.length} characters)`);
  const again = await context.newPage();
  await again.goto(link);
  await again.waitForFunction(() => Number(document.body.dataset.builds || 0) > 0);
  check(await again.inputValue('#source') === shared && !(await again.isVisible('#lesson')), 'opening the link restores the source, without the tutorial strip');
  await again.close();

  // ---------- phone width: one column, the editor above the preview ----------
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(PAGE);
  await phone.waitForFunction(() => document.body.dataset.shown === document.body.dataset.builds);
  const layout = await phone.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    return { wide: document.documentElement.scrollWidth, lesson: box('lesson').top, editor: box('editor'), frames: box('frames'), right: Math.max(...[...document.querySelectorAll('button, select, code')].map(el => el.getBoundingClientRect().right)) };
  });
  check(layout.wide <= 390 && layout.right <= 390 && layout.lesson < layout.editor.top && layout.editor.bottom <= layout.frames.top && layout.frames.width === 390 && layout.frames.top < 844 * .75,
    `at 390 px wide nothing sticks out sideways; the tutorial and the editor come first and the preview starts under them on the first screen (editor ${Math.round(layout.editor.top)} to ${Math.round(layout.editor.bottom)} px, preview ${Math.round(layout.frames.top)} to ${Math.round(layout.frames.bottom)} px of 844)`);
  if (shots) await phone.screenshot({ path: path.join(shots, '07-phone.png'), fullPage: true });
  await phone.evaluate(() => document.getElementById('frames').scrollIntoView({ block: 'center' }));
  await phone.waitForTimeout(1500);
  const small = await stage(phone);
  check(small.content > .002, `on the phone the preview plays at the full width of the screen (${percent(small.content)} of the stage stands out)`);
  if (shots) await phone.screenshot({ path: path.join(shots, '08-phone-preview.png') });
  await phone.close();

  check(errors.length === 0, `no console errors in the whole run${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log('\nplayground smoke test passed');
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);   // Chrome can be slow to hand back downloads
  process.exit(0);
}
main().catch(e => { console.error(`\nplayground smoke test FAILED: ${e.message}`); process.exit(1); });
