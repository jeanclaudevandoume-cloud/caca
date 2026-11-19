# Follower Town — art direction and review rubric

This file holds decisions that stay fixed between review rounds. A reviewer may change one only
under an explicit **OVERRIDE** heading with a reason and before/after evidence. The developer
keeps the code in line with it. (Written after a meta-review found that each fresh reviewer had
re-decided the palette — candy, then near-white, then mid-saturation — and the grade stalled.)

## References (the target look)

- **Day, residential:** a Tokyo Setagaya residential street at noon — warm beige, terracotta and
  sage walls, dark roofs, deep shade under eaves, trees with dark undersides.
- **Day, city:** Seoul/Tokyo mid-rise district — mixed warm stone, grey and dark facades, dark glass
  towers, colour only in signs, awnings and shopfronts.
- **Dusk/night:** Shinjuku side street — dark glass with specks of lit windows, glowing vertical
  signs, warm street light pools; never flat tan slabs.

## Value and colour rules (AD)

| Element | Value (HSV V) | Saturation | Notes |
|---|---|---|---|
| Residential walls | 0.60–0.88 | 0.15–0.38 | warm sand, terracotta, sage, slate blue, peach |
| City facades | 0.30–0.85 | 0.05–0.30 | include dark facades so blocks separate |
| Glass | 0.20–0.45 | 0.20–0.45 | dark; reflections give the light |
| Roofs | 0.25–0.50 | 0.15–0.45 | always darker than the wall below |
| Accents | any | 0.5–0.9 | signs, awnings, doors, shopfronts only |
| Custom homes | ≤ 0.75 | ≤ 0.32 | walls; full accent only on caps and cones |

Palettes (town.js): WALL `e8c9a0 d99a6c b8c9a3 9fb7c9 e6b8a2 f1e4c8 c98f5e 8fa89a`;
CITY `c9a27e 8e9aa6 d8c3a0 5f6b78 b5876a e0d6c4 4a5560`; GLASS dark blues/teals/bronzes only;
ROOF `b4533a 4b5663 3a3e45 5e7a48 3f8c84 9a3c31 7a5638 2f4d7a`.

### OVERRIDE (meta-review 3): roof saturation
Roofs S ≤ 0.60 (was 0.45), V ≤ 0.42. Clamping to 0.45 turned terracotta into mud/mauve and suburb saturation fell
below target while the image got less vibrant; the goal says "vibrant".

## Light (AD)

- Noon key `sun ≈ [1.3, 1.15, 0.95]`, sky ambient `≈ [0.30, 0.38, 0.55]`: lit/shade ratio ≥ 3.5:1.
- Sun azimuth about 25° off the street grid, so adjacent faces read lit / unlit.
- Tone: ACES fit at exposure 1.0, saturation lift ≈ 1.08. Fog far and slightly blue.
- Tall walls darken toward the street (canyon shade, 0.45 → 1.0 over 30 m); sun-averted faces ×0.8;
  neighbouring buildings differ by a hashed 0.85–1.0 value jitter.

## Composition (AD)

- The opening view looks down an avenue into the core from ~120 m: mid-rises with signs in front,
  towers silhouetted behind. It must show work at house scale, not only a far pincushion.

## Measurable targets (checked with tools/sheet.py on the fixed vantage set)

- Luma std (contrast): suburb ≥ 0.17, downtown ≥ 0.14, hub ≥ 0.16.
- Mean saturation: suburb ≥ 0.25, downtown ≥ 0.20.

## Performance budgets (checked with tools/vantage.cjs → shots/<tag>/stats.json + perf.json)

perf.json is measured in this container (software GL): use it for **ratios between builds**, never as device fps.

| Vantage | Tris | Draws | GPU MB | Notes |
|---|---|---|---|---|
| phone (low, 844x390) | ≤ 60k | ≤ 20 | ≤ 6 | ground pass ≤ 0.45× of `phonefull` |
| portrait (low, 390x844) | ≤ 75k | ≤ 20 | ≤ 6 | ground pass ≤ 0.45× of `portraitfull` |
| downtownlow (low) | ≤ 110k | ≤ 30 | ≤ 8 | |
| suburb / drone (high) | ≤ 490k | ≤ 50 | ≤ 35 | a Looks change adding > 5% tris needs a trade-off note |
| downtown / core / hub (high) | ≤ 520k | ≤ 85 | ≤ 35 | |

All vantages: allocations ≤ 8 KB/frame after warm-up (sampling heap profiler); boot to first frame ≤ 2 s here;
download ≤ 1 MB for the opening view at 1M followers.

Anchors: Optimization 9 = every vantage within budget, every sub-score measured, no regression vs the previous
build; 10 = also clear margin under budget.

## Review rubric (each 0–10; a 9 is described)

**Looks**
1. Value and contrast — 9: clear light/mid/dark structure in every vantage; nothing reads washed out.
2. Palette coherence — 9: the frozen palette, accents only where allowed; no candy, no grey soup.
3. Form and lighting — 9: every building reads as a solid with a lit side, shade side and grounding.
4. Default-view composition — 9: the opening frame alone sells "Seoul/Tokyo".
5. Street-level detail — 9: homes and shops hold up at 10 m; nothing looks like a placeholder.
6. Night and sunset — 9: dark glass with specks, glowing signs, warm pools; sunset has warm/cool contrast.

**Optimization**
1. Boot cost (layout/data at 1M and 10M). 2. Low-preset tris/draws per vantage. 3. Fill cost of
full-screen passes. 4. Per-frame allocations. 5. LOD artifacts/pops. 6. GPU memory.

## Process (revised after meta-review 3)

- **Grade the low preset first.** `phone`, `portrait`, `lowclose` and `lowdrone` are what the owner sees; together
  they weigh at least 40% of Looks.
- **Gating question each round:** "Would the owner still call these houses cheap on a phone?" (yes/no, with the
  phone shot).
- At most 1 of the 5 fixes may be accepted on a metric alone; every Looks fix names a vantage where it changes
  ≥ 5% of pixels, shown as a cropped before/after.
- One "structural bet" slot per round: a larger change judged by A/B on the phone vantages.
- Vantage cameras are frozen; if one must move, both builds are re-captured.

## Process (earlier rules, still in force)

- The reviewer sees before/after images of the fixed vantage set (`tools/vantage.cjs`,
  `tools/sheet.py`), not the previous scores. Every sub-score change must cite a vantage pair.
- At most 5 fixes per round, each with a vantage and a measurable acceptance test. **At least one slot goes to
  the axis with the most budget misses**, so one axis can't take every slot while the other regresses.
- The developer makes the change, captures the vantage set, and drops anything that does not show.
- An item is logged as done only when a measurement confirms it (probe, stats, Node check).
- Optimization sub-scores are graded from perf.json/stats.json before/after plus the code, and recorded in the log.
