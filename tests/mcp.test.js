const test = require('node:test'), assert = require('node:assert');
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const { handle, TOOLS } = require('../src/mcp');

const call = (name, args) => handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).result;
const deck = 'motion "Q3" 1280x720 6s accent=#2563eb mode=light\n  scene 3s\n    title "Q3 Review"\n  scene 3s\n    bars 1.2 1.4 1.6 labels=Jul,Aug,Sep\n';
const video = 'motion "Hi" 16:9 3s\n  rect at=0 color=#0B0F1A\n  text "HELLO" at=0 box=200,400,1520,200 size=160 align=center\n    pop dur=.3\n';

test('mcp: initialize, tool list and the guide', () => {
  const init = handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }).result;
  assert.equal(init.protocolVersion, '2025-06-18'); assert.equal(init.serverInfo.name, 'orb'); assert.ok(init.capabilities.tools);
  assert.deepEqual(handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools.map(t => t.name), ['orb_guide', 'orb_check', 'orb_build', 'orb_expand', 'orb_render']);
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.match(call('orb_guide', {}).content[0].text, /Orb video cheat sheet/);
  for (const t of TOOLS) assert.equal(t.inputSchema.type, 'object');
});
test('mcp: check reports both kinds of file, and errors as data with their line', () => {
  const page = JSON.parse(call('orb_check', { source: deck }).content[0].text);
  assert.deepEqual([page.ok, page.kind, page.scenes, page.lines], [true, 'interactive page', 2, 5]);
  const clip = JSON.parse(call('orb_check', { source: video }).content[0].text);
  assert.deepEqual([clip.ok, clip.kind, clip.duration, clip.width, clip.items], [true, 'video project', 3, 1920, 2]);
  const bad = call('orb_check', { source: video.replace('pop dur', 'popp dur') });
  assert.equal(bad.isError, true);
  assert.match(JSON.parse(bad.content[0].text).errors[0], /^line 4: unknown word 'popp'; did you mean 'pop'\?/);
});
test('mcp: build writes the page or the project; expand shows primitives', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-mcp-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const page = JSON.parse(call('orb_build', { source: deck, out: path.join(dir, 'deck.html') }).content[0].text);
  assert.ok(fs.statSync(page.out).size > 10000);
  const clip = JSON.parse(call('orb_build', { source: video, out: path.join(dir, 'clip') }).content[0].text);
  assert.ok(fs.existsSync(path.join(clip.out, 'index.html')));
  assert.match(call('orb_expand', { source: 'import "orb:std/charts" as c\nmotion "c" 16:9 4s\n  c.bars [1, 2]\n' }).content[0].text, /rect at=0\.09 box=/);
  assert.match(handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } }).error.message, /unknown tool 'nope'/);
});
test('mcp: speaks line-delimited JSON-RPC over stdio', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '../src/mcp.js')]);
  const lines = []; let buffer = '';
  child.stdout.on('data', d => { buffer += d; for (let at; (at = buffer.indexOf('\n')) >= 0;) { lines.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orb_check', arguments: { source: video } } }) + '\n');
  for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise(r => setTimeout(r, 50));
  child.kill();
  assert.deepEqual(lines.map(l => l.id), [1, 2]);
  assert.equal(JSON.parse(lines[1].result.content[0].text).ok, true);
});
