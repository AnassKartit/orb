# Prism cheat sheet

File = one `motion` line, then `scene` blocks (2 spaces), then elements (4 spaces).

    motion "Title" 1280x720 10s accent=#0ea5a4 mode=dark font=rounded   # accent+mode synthesise a validated palette; pick a colour that suits the topic
                                              # font: sans serif mono rounded display condensed or any family name; (older: bg=slate|aurora|sunset|paper)
      scene 3s                                # or: scene 0-3s
        eyebrow "SMALL LABEL"                 # tracked caps above a title
        title "Text"                          # also: sub, text (title+sub get an accent rule)
        count "Label" $1.2M                   # counts up
        bars 12 18 15 22 30 labels=Mon,Tue,Wed,Thu,Fri peak="PEAK DAY" title="DAILY SIGNUPS"   # peak= marks the highest bar; low="LOWEST" marks the lowest; add tone=good (green) or tone=bad (red) to colour the marked bar by meaning, default is neutral amber
        line 3 5 4 8 7 12 labels=Jan,Feb,Mar,Apr,May,Jun title="GROWTH %"
        donut web=52 app=31 api=17 title="PLATFORM SPLIT"
        orb color=blue spin=0.5               # 3D sphere + particles

Charts: values are labeled automatically (donut shows % on slices, in the legend and the top slice in the center).
title="CAPTION" adds a small heading; labels= adds x-axis names; a % in the title adds % units.
Options on any element: at=0.7 dur=1.2 in=<anim> ease=<ease> stagger=0.05
Look and place, on every element (text, counters, charts, images, slide parts, shapes): color=#ffd166 font=serif (same names as the motion line) weight=800
size=40 (px) or size=1.4x (the whole element, that much bigger) align=left|center|right spacing=.2em upper=on
x=-40 y=24 (px from where the layout put it) w=320 or w=50% h=200 rotate=-3 opacity=.6 bg=#00000055 pad=14 radius=12 border=#ffffff (or "3px dashed #fff") shadow=on
Charts: colors=#f66,#fc6,#6c9 (one per bar or slice, in turn) label-color= value-color= label-size= value-size= values=off labels=off grid=on|off w= h=
bars: bar=#4cc9f0 (every bar) peak-color= low-color= gap=28 radius=4 (bar corners) tag="NEW" tag-at=Fri (a label, or a position: 1 is the first bar)
line: stroke=#06d6a0 fill=off dots=off          donut: hole=.5 (0 is a pie)
Images: image image=photo.jpg w=520 h=300 fit=cover|contain radius=24 border=#fff shadow=on (no w or h: sized to fit the stage)
Whole scene: scene 5s align=left|center|right valign=top|center|bottom
In a row, a bare w= on a panel, card, col, grid or bullets is its share of the row (w=1.5); write w=320px for pixels.
An option an element does not take is an error that names the closest one and lists the ones it takes.
Animations: fade rise pop slide-l slide-r type blur grow draw sweep none
Eases: out inout back linear expo spring spring(n) in(n) out(n) inOut(n)   (spring = natural overshoot)
Timing: at=1.2 absolute, at=+0.3 after the previous element ends, at=< together with the previous; bars take from=center|last
Scene layout is automatic (charts side by side, counter + chart full width); override: scene 3s layout=stack|columns|left
Numbers of 1000 or more get thousands separators automatically.
A piece holds its last card when it ends (add loop=on to the motion line to repeat). Other motion options: present=on (click/arrow slideshow), numbers=on (slide counter), speed=1.4 (faster builds).
Defaults: elements cascade 0.35s apart; scenes fade out; content auto-fits the artboard.
Errors name the line and suggest the closest valid word.

Slide decks (a scene that holds one of these words is laid out as a slide; the compiler places and sizes everything):

    motion "Deck" 1280x720 look=midnight transition=slide build=rise present=on numbers=on
      scene 5s bg=photo.jpg dim=.4            # this slide's background: #101828, "linear-gradient(135deg,#1b2340,#3b0f4f)" or an image file next to the source
        cover "Title" sub="One line" note="Small line" image=hero.png      # full slide; variant=thanks for the closing slide; divider "Chapter" chapter=1
      scene 5s in=zoom out=fade               # in: how the slide arrives; out: how it leaves
        heading "Slide title"                 # also: lede "paragraph", note "small line", banner "wide pill", image image=pic.png
        row                                   # row, col and grid 3 hold other parts; w=1.5 gives one a bigger share
          card icon=shield-check label="Small" "Card text"   # icons: shield shield-check shield-lock user-check users lock gear handshake fingerprint file file-lock share clipboard check plus info
          panel header="Steps" tint=on        # a box with a header band; tint=on quiet band, big=on large band, soft=on grey box
            steps "First" "Second" "Third"
            outcome "What you get" label="Result"
            bullets "Point" "- sub point" "# group title" "**bold** and [[link]]" size=s
        table rail="Side label"               # one col per column
          col header="Column name"
            bullets "A" "B"
      scene 5s
        hub "Centre" left="Left box" right="Right box" lefticon=gear righticon=handshake

Looks: look=midnight (dark navy, glass cards), look=paper (warm light, serif headings), look=neon (near black, glowing borders). accent= mode= font= still apply on top.
Without look=, accent= and mode= colour the deck. Every slide part takes its colours from the mode, so text stays readable in dark and in light.
Slide background: bg= on a scene as above; dim=0..1 lays a veil over it so text stays readable. Text turns light on a dark background and dark on a light one by itself;
a picture counts as dark; mode=light|dark on the scene decides otherwise. For every slide: slide-bg= and slide-dim= on the motion line. Write gradients without spaces.
Slide transitions: scene in=fade|slide|zoom|wipe, the new slide replaces the previous one with that move; in=none cuts. out=fade fades the slide away at its end, out=none holds it.
Default: no move in, fade out. For every slide after the first: transition=slide on the motion line.
Builds: every slide part takes in= at= dur= ease=; in is one of fade rise lift pop blur type slide-l slide-r wipe grow none.
For the whole deck: build=pop on the motion line (rows, cols, grids, cover and divider keep their own); build=none shows each slide complete.

Talking and interactive characters (player/web, inside a scene):

    stage at=0                               # 2D character stage; put mascot, acts and bindings inside. Backdrop: a studio that follows the theme;
                                             # bg=sky for a meadow with clouds, bg="#0b1020,#1b2a55" for two colours of your own
      mascot "Hoot" kind=owl color=#58cc02 x=0.5 size=1    # kind: owl robot fox cat. One rig: every act, mood and machine works on each kind
      act "Hoot" talk audio="assets/line.mp3" at=1 dur=2 volume=0.8  # plays audio; mouth uses embedded 30 Hz RMS
      act "Hoot" talk text="Hello there!" at=4 dur=2               # seeded syllable rhythm; no speech synthesis
      machine "Hoot" blend=0.2                # character name; crossfade state poses over 0.2 seconds
        input hovered bool                    # bool defaults false
        input poke trigger                    # event, consumed once per fire
        input level number 0..1               # number defaults to clamped 0; API values clamp to range
        state idle: act idle loop             # first unconditional state is the default; loop repeats an act
        state curious when hovered: act look to=pointer; act feel to=happy
        state giggle on poke: act laugh dur=1.2 -> idle   # trigger interrupts; timed return to a named state
      on hover "Hoot" hovered                 # pointer enter/leave sets a bool input
      on click "Hoot" poke                    # click fires a trigger input
      on pointer "Hoot" look                  # eyes/head follow pointer; works without a machine too
    audio "assets/line.mp3" at=1 dur=2 volume=0.8         # standalone audio, same seek/play/pause clock

Acts: talk nod wave laugh look (to=left|right|up|down|pointer) idle cheer sad hop, and feel to=neutral|happy|sad|surprised|angry|sleepy|love
(a mood that stays; mood= on the mascot is the one it starts with). The ground shadow follows hops; blinks are built in.
Audio paths are relative to the source file; build requires local `ffmpeg`. Audio and quantized RMS envelopes
are embedded once per file; omitted audio/talk-audio `dur` uses the decoded length. Use either the standalone
`audio` element or `act talk audio=` for a line (both play). Browsers may require a play/click gesture for sound.
State actions may also be indented under `state name:`; `at=` is state-local and actions separated by `;`
run together unless timed. `when !hovered` and `when level >= 0.5` are supported; the first matching `when`
state wins. `on` trigger states finish before bool/number changes can interrupt; another trigger restarts them.
An explicit `->` return wins until the next input change.
States can override `blend` before the colon: `state curious when hovered blend=0.1: act look to=pointer`.
From JS: `orb.set("hovered", true)`, `orb.set("Hoot.level", 0.7)`, `orb.fire("poke")` (qualify ambiguous inputs
as `Character.input`). Input/pointer events use player time and replay on seeks; paused time freezes animation.
Machines currently drive 2D mascots; present-mode decks keep their click/arrow controls.
Reuse (same in every Orb file): `let x = 3`, `{x*2}` in any value, `repeat 3 as i`, `if x > 2`, `def card2(title, tone=blue)` + indented body
(call `card2 "Hi"` or `card2 title="Hi" tone=red`; a `slot` line in the body takes the caller's indented children), `import "./brand.orb"`,
`import "./brand.orb" as b` then `b.card2 ...`. `orb build file -o out` builds either kind of file; `orb expand file` prints it expanded.
