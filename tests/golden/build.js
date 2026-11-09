// Golden corpus: every example compiled by the current compiler, hashed. `node tests/golden/build.js --write` re-baselines.
// Asset names embed a hash of the absolute source path (hf.js), so they are normalised to keep goldens portable.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const norm = s => s.replace(/assets\/[0-9a-f]{10}-/g, 'assets/H-').split(root).join('<ROOT>');

function corpus() {
  const prism = walk(path.join(root, 'examples')).filter(f => f.endsWith('.prism')).sort();
  const orb = fs.readdirSync(path.join(root, 'examples/hf')).filter(f => f.endsWith('.orb')).sort().map(f => path.join(root, 'examples/hf', f));
  return { prism, orb };
}
function run() {
  const { compile } = require(path.join(root, 'src/prism'));
  const { build } = require(path.join(root, 'src/hf'));
  const out = {};
  const { prism, orb } = corpus();
  for (const f of prism) {
    const key = path.relative(root, f);
    try { out[key] = sha(compile(fs.readFileSync(f, 'utf8'), { baseDir: path.dirname(f) })); }
    catch (e) { out[key] = 'ERROR ' + norm(e.message); }
  }
  for (const f of orb) {
    const key = path.relative(root, f), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-golden-'));
    try {
      const warnings = [];
      build(fs.readFileSync(f, 'utf8'), dir, { baseDir: path.dirname(f), onWarning: w => warnings.push(w) });
      const files = {};
      for (const g of walk(dir).sort()) {
        const rel = norm(path.relative(dir, g));
        if (rel.startsWith('assets/')) { files[rel] = 'asset'; continue; }
        files[rel] = sha(norm(fs.readFileSync(g, 'utf8')));
      }
      out[key] = { files, warnings: sha(warnings.join('\n')) };
    } catch (e) { out[key] = 'ERROR ' + norm(e.message); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
module.exports = { run };
if (require.main === module) {
  const file = path.join(__dirname, 'golden.json'), now = run();
  if (process.argv.includes('--write')) { fs.writeFileSync(file, JSON.stringify(now, null, 1) + '\n'); console.log(`wrote ${Object.keys(now).length} goldens`); }
  else {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bad = [...new Set([...Object.keys(old), ...Object.keys(now)])].filter(k => JSON.stringify(old[k]) !== JSON.stringify(now[k]));
    if (bad.length) { console.error('golden mismatch:\n  ' + bad.join('\n  ')); process.exit(1); }
    console.log(`golden ok (${Object.keys(now).length} files)`);
  }
}
