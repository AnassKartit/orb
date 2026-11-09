# Orb video cheat sheet (HyperFrames target, MP4 output)

File = `motion` line, items at 2 spaces; group children and animation verbs 2 more spaces. All times are seconds.
Use video grammar for footage, audio, images, captions and precise layout. Player charts/decks use a separate grammar.

    motion "Title" 16:9 30s fps=30 assets=assets voice=voice.words.json # also 9:16 1:1 4:5 or 1920x1080; duration may be @end
      bus music volume=.4                       # voice (default), music, sfx
      font "brand.woff2" as Brand
      style big = size=140 font=Brand color=#fff align=center stroke="12px #000" in=pop
      rect at=0 color="radial-gradient(1200px 800px at 50% 40%,#1B2340,#0B0F1A 70%)"
      video "take.mp4" at=3 dur=12 trim=20 rate=1 sound=off fit=cover box=0,0,1920,1080 crop=.1,0,.8,1 loop=on radius=24
      image "shot.png" at=0 dur=4 fit=contain box=200,200,800,500
      audio "voice.mp3" at=0 bus=voice volume=1 fade=.1,.3
      audio "music.mp3" at=0 bus=music volume=.3 trim=2
      sfx whoosh at=3                            # bundled synthetic CC0: whoosh pop ping click riser; audio "ping" also works
      text "HELLO *WORLD*" style=big box=240,300,1440,180 emph=#FFE600 bg=#000a radius=16 pad="12 20" out=fade
      captions "voice.words.json" at=0 box=240,780,1440,160 size=72 highlight=#FFE600 max-words=4
      group at=5 dur=4 box=400,200,1000,600 layout=stack clip=on radius=20 border="4px solid #fff"
        text "Auto-stacked" at=0 box=0,0,800,120
        text "Second row" at=0 box=0,0,800,120
      comp "compositions/block.html" vars={"title":"Hi"} # mount a HyperFrames composition
      html                                      # raw indented HyperFrames markup, last resort

Box = x,y,w,h in canvas pixels, relative to a parent group. Defaults: full-frame media and their groups are backgrounds, other media
in the middle, text/captions on top; explicit `layer=` overrides. Common: `id at dur until layer track in out ease
filter origin style drift in-dur out-dur in-x in-y in-scale`. Visuals share `radius border shadow clip opacity`;
`box-shadow=shadow` (on text `shadow` is the text shadow, `box-shadow` the box's), `colour=color`, `background=bg`, `border-radius=radius`, `alpha=opacity`, `font-size=size`,
`font-family=font`, `text-align=align`. Text: `size weight font color align bg pad emph stroke leading spacing
word-pad fill whitespace height width sizing bold-size small-size small-color border-left words fit`.
Text auto-fits its box but never below 60% of the size you wrote (then it overflows visibly); `fit=off` disables fitting. `color=auto` chooses
black/white against backdrops (including readable media pixels). Your boxes and sizes are kept as written; only text placed outside the canvas is moved back in.
Overlapping simultaneous text warns with both lines; `layout=stack` on a group arranges rows. Captions default to at=0. Text keeps spaces.
Assets search `assets=`, source folder, `ORB_ASSETS` (path-separated shared folders, including fonts/sfx), bundled sfx;
missing assets show searched folders and a filename suggestion. Local assets override bundled names, including .mp3 aliases.

Time: `at=2`, `at=+0.3` after previous ends, `at=<` with previous. Voice: `voice=dir` needs timing.json + words/<id>.words.json;
`voice="voice.words.json"` gives one line `v0` at 0, accepting word or text fields. Directory/prefix shorthand finds
voice.words.json or <prefix>.words.json. `at=@v3`, `at=@v3"one shot"+0.2`, `until=@next(v3)`, `@end`;
`at=@"click Create"` or `@voice"click Create"` for a single words file. Animation times are item-relative; `abs=on` is global.

Animation children: `to x= y= scale= scale-x= scale-y= rotate= opacity= blur= from=`; `zoom box= hold=2`;
`highlight box= color=`; `shake x= y= times=`; `flash color= opacity=`; `pulse scale= opacity= times= from=`;
`punch scale=`; `push from=1 to=1.1`; `spin deg=`; `wipe dir=l|r|u|d reverse=on`; `pop rotate= rest-rotate= scale= y=`;
`count from=0 to=4800 format="{n:,} USERS"`; `drain dir=`; `karaoke at=0,.3,.6 color=`;
`filter grayscale= blur= brightness= saturate= hue= contrast=`; `type cursor=#fff blink=.4`.
All take `at= dur= ease=`; comma-separated `at=1.6,4.2` repeats. in/out: fade rise lift pop slide-l slide-r type blur grow draw sweep wipe none.

Components: `def chip(copy, at, dur=3, color=#00E5FF)` + indented body; call by position (`chip "READ" 1.6`),
by name (`chip "READ" at=1.6 color=#FFE600`) or both. A `slot` line in the body is where the caller's indented
children go (`slot footer` = the children of a `footer` block), so a call can add verbs or items:
`caption "LOOPS." at=3` + indented `shake dur=.3`. `{W}` and `{H}` are the canvas size: `box={W*.1},{H*.6},{W*.8},200`.
Modules: `import "./brand.orb"` (its let, def, data, style, font), `import "orb:std/short" as s` then `s.caption ...`,
`from "./brand.orb" import chip, ink`. Standard library `orb:std/short`: `backdrop`, `hook "TEXT"`,
`caption "TEXT" at= dur= times="0,.3"`, `chip "TEXT" at= x= y= w=`, `badge "TEXT" at= y=.4`,
`stat "154" "label" at=`, `nameplate "Name" "Role"`, `beat at`. `orb expand f.orb` prints the file fully expanded.
Reuse: `let x = value`; `def name(a, b)` + body, call `name "A" 2`; `repeat 3 as i`; `if cond`;
`data rows` + indented `name="Orb" color="#c6f47b"`, or `data rows "f.json"` / `data rows "f.csv"`;
`repeat rows as m` with `{m.name}`, `{i}`, `{120+i*650}`. Literal braces: `\{copy\}` prints {copy}.
Rich text: `*word*`, `*w*{color=#c6f47b size=80}`, `<br>`, `<b>`, `<small>`, `[img a.svg]`.

CLI: `orb build f.orb -o dir` builds and checks all keyframes; `orb check f.orb [-o dir] [--sheet]` also checks,
with a 1 fps contact-sheet.png for --sheet. Errors/contrast map to `line N`, exit nonzero on errors or incomplete checks.
`orb preview f.orb` opens Studio; `orb render f.orb out.mp4 1080|2K|4K [9x16|16x9|1x1|4x5]`. Unknown options list valid words.
