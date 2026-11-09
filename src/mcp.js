#!/usr/bin/env node
// Orb as an MCP server, so any AI agent can write, check and render Orb.
//   claude mcp add orb -- node /path/to/orb/src/mcp.js        (or: orb mcp)
// Speaks JSON-RPC 2.0 over stdio, one JSON message per line. No dependencies.
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const isPlayer = source => /^ {2}scene(\s|$)/m.test(source);
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const TOOLS = [
  {
    name: 'orb_guide',
    description: 'The complete Orb reference (two short cheat sheets). Read it once before writing Orb. Orb is a small language for videos, presentations and interactive animations: a file with `scene` blocks becomes an interactive page (decks, charts, characters, state machines); a file of timed items (text, image, video, audio, group) becomes a video.',
    inputSchema: { type: 'object', properties: {} },
    run() { return ['SPEC.md', 'SPEC-HF.md'].map(f => fs.readFileSync(path.join(root, 'docs', f), 'utf8')).join('\n\n'); },
  },
  {
    name: 'orb_check',
    description: 'Compile Orb source without keeping the output. Returns ok, errors (each with its line and a suggestion) and warnings. Call it after writing or editing a file, fix what it reports, call again.',
    inputSchema: { type: 'object', required: ['source'], properties: { source: { type: 'string', description: 'The Orb file contents' }, dir: { type: 'string', description: 'Folder that holds the media and modules the file refers to (default: current folder)' } } },
    run({ source, dir }) { const out = tmp('orb-check-'); try { return compile(source, out, dir); } finally { fs.rmSync(out, { recursive: true, force: true }); } },
  },
  {
    name: 'orb_build',
    description: 'Compile Orb source and keep the result. A file with scenes gives one self-contained interactive HTML page; any other file gives a HyperFrames video project folder (index.html, compositions, assets). Returns the output path.',
    inputSchema: { type: 'object', required: ['source', 'out'], properties: { source: { type: 'string' }, out: { type: 'string', description: 'Output: a .html path for scene files, a folder for video files' }, dir: { type: 'string', description: 'Folder that holds the media and modules the file refers to' } } },
    run({ source, out, dir }) { return compile(source, path.resolve(out), dir, true); },
  },
  {
    name: 'orb_expand',
    description: 'Show Orb source with every import, def, repeat and if expanded into the primitive items it stands for. Use it to see what a component does.',
    inputSchema: { type: 'object', required: ['source'], properties: { source: { type: 'string' }, dir: { type: 'string' } } },
    run({ source, dir }) {
      const baseDir = path.resolve(dir || '.');
      const out = isPlayer(source) ? require('./lang').expand(source, { dialect: 'player', baseDir }) : require('./hf').expandSource(source, { baseDir });
      return out.text;
    },
  },
  {
    name: 'orb_render',
    description: 'Render an Orb file on disk to an MP4. Slow (minutes): call orb_check first. size is 1080, 2K or 4K; aspect optionally reframes (9x16, 16x9, 1x1, 4x5).',
    inputSchema: { type: 'object', required: ['file', 'out'], properties: { file: { type: 'string' }, out: { type: 'string' }, size: { type: 'string', enum: ['1080', '2K', '4K'] }, aspect: { type: 'string', enum: ['9x16', '16x9', '1x1', '4x5'] }, draft: { type: 'boolean' } } },
    run({ file, out, size, aspect, draft }) {
      const { spawnSync } = require('child_process');
      const args = [path.join(__dirname, 'prism.js'), 'render', path.resolve(file), path.resolve(out), size || '1080', ...(aspect ? [aspect] : []), ...(draft ? ['--draft'] : [])];
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'render failed').trim().split('\n').slice(-5).join('\n'));
      return { ok: true, out: path.resolve(out) };
    },
  },
];

// One compile path for check and build. Errors come back as data, with their line, so a model can fix them.
function compile(source, out, dir, keep = false) {
  const baseDir = path.resolve(dir || '.');
  const result = { ok: true, kind: isPlayer(source) ? 'interactive page' : 'video project', errors: [], warnings: [] };
  try {
    if (isPlayer(source)) {
      const html = require('./prism').compile(source, { baseDir });
      const motion = require('./prism').parse(source, { baseDir });
      Object.assign(result, { duration: motion.dur, scenes: motion.scenes.length, bytes: html.length });
      if (keep) { const file = /\.html$/.test(out) ? out : path.join(out, 'index.html'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); result.out = file; }
    } else {
      const motion = require('./hf').build(source, out, { baseDir, onWarning: w => result.warnings.push(w) });
      Object.assign(result, { duration: motion.duration, width: motion.width, height: motion.height, fps: motion.fps, items: motion.children.length });
      if (keep) result.out = out;
    }
  } catch (e) {
    if (!/^line \d+:/.test(e.message)) throw e;
    result.ok = false; result.errors.push(e.message);
  }
  result.lines = source.replace(/\n$/, '').split('\n').length;
  return result;
}

function handle(message) {
  const { id, method, params = {} } = message;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'orb', version: require('../package.json').version }, instructions: 'Call orb_guide once, write Orb, then orb_check until it is clean, then orb_build or orb_render.' });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params.name);
    if (!tool) return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool '${params.name}'; tools: ${TOOLS.map(t => t.name).join(', ')}` } };
    try {
      const value = tool.run(params.arguments || {});
      return reply({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }], isError: value && value.ok === false });
    } catch (e) { return reply({ content: [{ type: 'text', text: `orb: ${e.message}` }], isError: true }); }
  }
  if (id === undefined) return null;   // a notification: nothing to answer
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method '${method}' is not supported` } };
}

function serve(input = process.stdin, output = process.stdout) {
  console.log = console.error;   // stdout carries the protocol only
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    for (let at; (at = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!line) continue;
      let answer;
      try { answer = handle(JSON.parse(line)); } catch (e) { answer = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'invalid JSON: ' + e.message } }; }
      if (answer) output.write(JSON.stringify(answer) + '\n');
    }
  });
}

module.exports = { serve, handle, TOOLS };
if (require.main === module) serve();
