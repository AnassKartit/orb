const { createPlayerCore } = require('./player-state');
const { createPlayerBrowser } = require('./player-browser');

// Extend only pages opting into the new vocabulary. runtime.js stays the byte-for-byte
// legacy player, and exact anchors fail loudly if a future edit invalidates integration.
function enhance(legacy) {
  let source = legacy;
  function replace(from, to) {
    if (!source.includes(from)) throw new Error(`player runtime integration anchor missing: ${from.slice(0, 70)}`);
    source = source.replace(from, to);
  }
  replace('  const M = window.__PRISM__;', `  const M = window.__PRISM__;\n  const core = (${createPlayerCore.toString()})();\n  const player = (${createPlayerBrowser.toString()})(M, core, () => t, () => seek(t));`);
  replace("  const scenes = M.scenes.map(sc => {", "  const scenes = M.scenes.map((sc, sceneIndex) => {");
  replace('builders[el.type](el, host, add)', 'builders[el.type](el, host, add, sceneIndex)');
  replace('    stage(el, host) {', "    stage(el, host, add, sceneIndex) {\n      host.style.pointerEvents = 'none'; // the full-scene text stack must not cover mascot hit targets");
  replace("const gid = 'mg' + i + '_' + Math.round(Math.random() * 1e6);", "const gid = 'mg' + sceneIndex + '_' + el.line + '_' + i;");
  replace('        mascots[c.text[0]] =', '        player.bind(c.text[0], g0, sceneIndex, svg);\n        mascots[c.text[0]] =');
  replace("      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, target: c.named.to }));", "      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, target: c.named.to, audio: c.audio, text: c.named.text }));");
  replace('T.mouth.scale.y = 0.35 + 0.65 * Math.abs(s(11)) * w;', 'T.mouth.scale.y = 0.35 + 0.65 * (a.audio || a.text !== undefined ? player.mouth(a, lt) : Math.abs(s(11)) * w);');
  replace("      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, to: c.named.to }));", "      const acts = kids.filter(c => c.type === 'act').map(c => ({ who: c.text[0], verb: c.args[0], at: c.at, dur: c.dur, to: c.named.to, audio: c.audio, text: c.named.text }));");
  replace("      const feels = (who) => acts.filter(a => a.who === who && a.verb === 'feel').sort((a, b) => a.at - b.at);", '');
  const poseStart = source.indexOf('          const U = m.U, ph = t * 2.2 + m.seed;');
  const poseEnd = source.indexOf("          m.g0.setAttribute('transform',", poseStart);
  if (poseStart < 0 || poseEnd < 0) throw new Error('player mascot pose anchors missing');
  source = source.slice(0, poseStart) + `          const U = m.U;
          const { cur, jy, sx, sy, rot, wl, wr, open, px, py, squint, brow, browY, confK: ck } = player.pose(acts, m.name, sceneIndex, t, m.base, MOOD, m.seed, U);
          if (ck >= 0) { confK = ck; confX = m.px; confY = m.py - 300 * U; }
` + source.slice(poseEnd);
  replace('  function seek(x) {', '  function seek(x, scrubbed = true) {');
  replace('    render(t);', '    player.update(t, playing, scrubbed);\n    render(t);');
  replace('        seek(t);', '        seek(t, false);');
  replace("playing = !playing; play.textContent = playing ? 'Pause' : 'Play';", "playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; player.update(t, playing, true);");
  replace("window.pause = () => { playing = false; play.textContent = 'Play'; };", "window.pause = () => { playing = false; play.textContent = 'Play'; player.update(t, false, true); };");
  // Browser autoplay can require a gesture; retry from the existing player controls.
  replace("  addEventListener('resize', fit);", "  document.addEventListener('pointerdown', () => player.update(t, playing, true));\n  addEventListener('resize', fit);");
  return source;
}
module.exports = { enhance };
