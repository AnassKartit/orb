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
Animations: fade rise pop slide-l slide-r type blur grow draw sweep none
Eases: out inout back linear expo spring spring(n) in(n) out(n) inOut(n)   (spring = natural overshoot)
Timing: at=1.2 absolute, at=+0.3 after the previous element ends, at=< together with the previous; bars take from=center|last
Scene layout is automatic (charts side by side, counter + chart full width); override: scene 3s layout=stack|columns|left
Numbers of 1000 or more get thousands separators automatically.
A piece holds its last card when it ends (add loop=on to the motion line to repeat). Other motion options: present=on (click/arrow slideshow), numbers=on (slide counter), speed=1.4 (faster builds).
Defaults: elements cascade 0.35s apart; scenes fade out; content auto-fits the artboard.
Errors name the line and suggest the closest valid word.

Talking and interactive characters (player/web, inside a scene):

    stage at=0                               # 2D character stage; put mascot, acts and bindings inside
      mascot "Hoot" color=#58cc02 x=0.5
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
