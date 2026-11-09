import sys, tiktoken
enc = tiktoken.get_encoding("cl100k_base")
def n(path):
    s = open(path, encoding="utf-8").read()
    return len(enc.encode(s)), len(s.encode())
rows = [("Orb (q4.prism)", "examples/q4.prism"),
        ("GSAP version (html, excl. library)", "benchmark/q4-gsap.html"),
        ("Plain HTML/CSS/JS", "benchmark/q4-plain.html")]
spec_t, _ = n("docs/SPEC.md")
orb_t = n("examples/q4.prism")[0]
print(f"{'version':38} {'tokens':>7} {'bytes':>7}  vs Orb")
for name, p in rows:
    t, b = n(p)
    print(f"{name:38} {t:7d} {b:7d}  {t/orb_t:5.1f}x")
print(f"\nOrb spec (cheat sheet in context): {spec_t} tokens")
plain_t = n("benchmark/q4-plain.html")[0]; gsap_t = n("benchmark/q4-gsap.html")[0]
for k in (1, 3, 10, 50):
    print(f"{k:3d} animations: Orb {spec_t + k*orb_t:6d} (spec once + {k}x)  GSAP {k*gsap_t:6d}  plain {k*plain_t:6d}")
