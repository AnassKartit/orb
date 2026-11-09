# Orb against GSAP, plain HTML and anime.js: tokens written for six briefs

Each brief was written once in each format by the same model. The files are in `runs/b1` to `runs/b6`.
Tokens are counted with tiktoken cl100k, a stand-in for each model's own tokenizer (`tokens.py`).

| brief | Orb | GSAP | plain HTML, CSS, JS | anime.js v4 | GSAP / Orb |
|---|---|---|---|---|---|
| b1 | 154 | 3,892 | 3,765 | 4,293 | 25.3x |
| b2 | 118 | 3,879 | 3,385 | 4,328 | 32.9x |
| b3 | 139 | 3,188 | 3,612 | 4,486 | 22.9x |
| b4 | 209 | 2,926 | 4,140 | 3,676 | 14.0x |
| b5 | 171 | 3,313 | 4,246 | 2,685 | 19.4x |
| b6 | 235 | 3,486 | 3,171 | 4,510 | 14.8x |
| **total** | **1,026** | **20,684** | **22,319** | **23,978** | **20.2x** |

Plain HTML is 21.8x and anime.js 23.4x the Orb total.

What these numbers leave out, and what they include:

- **b6.** The first Orb file for b6 (`runs/b6/orb.prism`, 192 tokens) labelled a bar in a way the data contradicts, and
  the compiler rejects it. The table counts the corrected file, `runs/b6/orb_v2.prism` (235 tokens).
- **The cheat sheets are input.** A model reads `docs/SPEC.md` (2,611 tokens) and `docs/SPEC-HF.md` (1,817 tokens)
  once per session: 4,428 tokens. Counted once against these six briefs, Orb is 5,454 tokens against 20,684 for
  GSAP, 3.8x.
- **The compiler chooses the look here.** When an Orb file dictates every position and size to rebuild an existing
  video exactly, the saving measured on two real videos was 4.5x and 5.8x.
- **Quality** was scored blind on the same six briefs (`results.json`, round 5): Orb 4.10 out of 5, plain HTML 3.67,
  GSAP 3.47, anime.js 3.30. The judges came from the same model family as the writer, and differences under about
  0.3 are noise.
