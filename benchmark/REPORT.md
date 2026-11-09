# Orb vs GSAP verification

Target: Orb output at least 5x smaller than GSAP, page renders without errors. Spec in context: 470 tokens (paid once).

| brief | Orb | GSAP | plain | GSAP/Orb | errors | scenes shrunk to fit | pass |
|---|---|---|---|---|---|---|---|
| b1 | 154 | 3892 | 3765 | 25.3x | 0 | - | PASS |
| b2 | 118 | 3879 | 3385 | 32.9x | 0 | - | PASS |
| b3 | 139 | 3188 | 3612 | 22.9x | 0 | - | PASS |
| b4 | 209 | 2926 | 4140 | 14.0x | 0 | - | PASS |
| b5 | 171 | 3313 | 4246 | 19.4x | 0 | [3] | PASS |
| b6 | 192 | 3486 | 3171 | 18.2x | 0 | - | PASS |

Total: Orb 983 tokens (1453 with spec once) vs GSAP 20684 (21.0x).

Token counts use tiktoken cl100k as a proxy for Claude's tokenizer. Quality parity is scored blind (see judge/).
