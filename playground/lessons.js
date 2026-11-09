// Learn Orb: the steps of the tutorial strip above the editor. Each step is a small file and one thing to change.
//   title   what the step is about
//   say     one sentence of instruction (HTML: <code> marks what to type)
//   source  the file the step starts from
//   done    source -> true once the change is there (the playground also checks that the file compiles)
//   show    source -> the source with the change made, for the "Show me" button
//   point   'swatch' draws attention to the colour swatches under the editor
// Loaded after orb-compiler.js: one step starts from a sample.
var ORB_LESSONS = [
  {
    title: 'Change the title',
    say: 'Line 3 is the title. Replace <code>Hello, Orb</code> with your own words and watch it play.',
    source: 'motion "My first Orb" 1280x720 4s accent=#7c5cff\n  scene 4s\n    title "Hello, Orb" in=rise',
    done: source => /^ {4}title "(?!Hello, Orb")[^"]+"/m.test(source),
    show: source => source.replace(/^( {4}title )"[^"]*"/m, '$1"Made in three lines"'),
  },
  {
    title: 'Change the accent colour',
    say: 'Click the purple swatch under the editor and pick another colour. It rewrites <code>accent=</code> on line 1.',
    point: 'swatch',
    source: 'motion "My first Orb" 1280x720 4s accent=#7c5cff\n  scene 4s\n    title "Colour me in" in=rise',
    done: source => /^motion .*\baccent=#(?!7c5cff\b)[0-9a-f]{6}\b/im.test(source),
    show: source => source.replace(/accent=#[0-9a-f]+/i, 'accent=#ff2d78'),
  },
  {
    title: 'Add a second line of text',
    say: 'Add this line under the title, with the same four spaces in front: <code>sub "Written in four lines"</code>',
    source: 'motion "My first Orb" 1280x720 4s accent=#ff2d78\n  scene 4s\n    title "One more line" in=rise',
    done: source => /^ {4}sub "[^"]+"/m.test(source),
    show: source => source.trimEnd() + '\n    sub "Written in four lines"',
  },
  {
    title: 'Add a counter',
    say: 'A number that counts up is one line. Add it under the label: <code>count "Signups" 4800</code>',
    source: 'motion "Launch week" 1280x720 5s accent=#0ea5a4\n  scene 5s\n    eyebrow "LAUNCH WEEK"',
    done: source => /^ {4}count "[^"]+" \S*\d/m.test(source),
    show: source => source.trimEnd() + '\n    count "Signups" 4800',
  },
  {
    title: 'Add a bar chart and mark the peak',
    say: 'Add a chart under the counter: <code>bars 120 340 560 800 1100 980 900 peak="BEST DAY"</code>',
    source: 'motion "Launch week" 1280x720 6s accent=#0ea5a4\n  scene 6s\n    eyebrow "LAUNCH WEEK"\n    count "Signups" 4800',
    done: source => /^ {4}bars(?: +[\d.]+){2,}.*\bpeak="[^"]+"/m.test(source),
    show: source => source.trimEnd() + '\n    bars 120 340 560 800 1100 980 900 peak="BEST DAY"',
  },
  {
    title: 'Add a second slide',
    say: 'This file is a deck. Add <code>scene 5s</code> with two spaces in front, and under it <code>heading "Slide two"</code> with four. Then click the preview or press the right arrow.',
    source: 'motion "My deck" 1280x720 bg=ms present=on\n  scene 5s\n    heading "Slide one"\n    lede "Click the preview, or press the right arrow."',
    done: source => (source.match(/^ {2}scene\b/gm) || []).length >= 2,
    show: source => source.trimEnd() + '\n  scene 5s\n    heading "Slide two"\n    lede "The left arrow goes back."',
  },
  {
    title: 'Meet the character',
    say: 'Hover the owl, then click it. To change its colour, click the green swatch under the editor.',
    point: 'swatch',
    source: Orb.samples.find(sample => sample.title.includes('interactive character')).source,
    done: source => /^ +mascot "[^"]+".*\bcolor=#(?!58cc02\b)[0-9a-f]{3,8}\b/im.test(source),
    show: source => source.replace(/#58cc02/gi, '#ff8a00'),
  },
  {
    title: 'Place a headline and make it pop',
    say: 'A file without scenes is a video: every item has a <code>box=x,y,width,height</code>. Change the box to <code>box=160,420,1600,240</code>, then add <code>pop</code> on a new line under the headline, four spaces in.',
    source: 'motion "Headline" 16:9 5s\n  rect at=0 color=#0b0f1a\n  text "MOVE ME" at=.3 box=160,120,1600,240 size=200 weight=900 color=#ffe600 align=center',
    done: source => /^ {2}text .*\bbox=(?!160,120,1600,240\b)[\d.,]+/m.test(source) && /^ {4}pop\b/m.test(source),
    show: source => source.replace('box=160,120,1600,240', 'box=160,420,1600,240').trimEnd() + (/^ {4}pop\b/m.test(source) ? '' : '\n    pop'),
  },
  {
    title: 'Use the standard library',
    say: 'Line 1 imports charts that are themselves written in Orb. Put your own numbers and names between the square brackets on the last line.',
    source: 'import "orb:std/charts" as c\nmotion "My numbers" 16:9 6s\n  rect at=0 color=#0b0f1a\n  c.bars [3, 5, 8] [\'Mon\', \'Tue\', \'Wed\'] at=.3 dur=5.7 badge=\'BEST\'',
    done: source => /^ {2}c\.bars \[(?!3, 5, 8\])[^\]]*\d[^\]]*\]/m.test(source),
    show: source => source.replace(/c\.bars \[[^\]]*\] \[[^\]]*\]/, "c.bars [12, 18, 9, 24] ['Q1', 'Q2', 'Q3', 'Q4']"),
  },
];
