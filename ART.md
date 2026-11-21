# Follower Town — art direction and review rubric

## LOCKED DECISION (four-reviewer round A)
Follower Town is **a Tokyo/Seoul city rendered as a sunlit miniature**. Homes use Japanese and Korean residential
types only: narrow 2–3 storey *jūtaku* (built-in garage, balcony, mono-pitch or low gable roof with thin eaves, or a
flat roof with a parapet) close to the street on paved lots with planting strips; Seoul brick villas over an open
parking storey with green/blue rooftops and water tanks; utility poles with sagging wires; vending machines.
Colour comes from sky, greenery, doors, signs, vending machines and rooftops — not from pastel walls.
American-suburb vocabulary is banned on every preset: lawns, deep-eave hip roofs, white cross-mullion windows on
every cell, porches, garden walls, yellow centre lines on residential lanes. Towers pair up on two plots (no needles)
with mechanical bands every 8 floors. This replaces the earlier WALL/ROOF/TOWN palettes and the "Setagaya lawn" look
(OVERRIDE recorded here; suburb saturation target lowered to ≥ 0.22).


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

### LOCKED (round J): sun direction for the opening view
Round H (sun from the SSW, behind the camera) was graded "front-lit, flat, shadows hidden"; round I (sun from the WNW)
was graded "every street front in shade, mud". Both at once are satisfied by the day sun from the **south-west**
(~45° to the lanes): from the opening camera fronts take raking light, west walls are lit, east walls are in shade,
and shadows fall east across the north-south lanes. Changing it needs an OVERRIDE with phoneauto before/after crops.

- Noon key `sun ≈ [1.3, 1.15, 0.95]`, sky ambient `≈ [0.30, 0.38, 0.55]`: lit/shade ratio ≥ 3.5:1.
- Sun azimuth about 25° off the street grid, so adjacent faces read lit / unlit.
- Tone: ACES fit at exposure 1.0, saturation lift ≈ 1.08. Fog far and slightly blue.
- Tall walls darken toward the street (canyon shade, 0.45 → 1.0 over 30 m); sun-averted faces ×0.8;
  neighbouring buildings differ by a hashed 0.85–1.0 value jitter.

## Composition (AD)

### OVERRIDE (meta-review, round F): the opening view shows homes
The avenue view (round B) showed zero homes in portrait: the narrow frame cropped the mid-rises out and left
asphalt, lawn and a wall of plain boxes. The product is "your follower's home", so the opening view is now a low
drone (y 40, pitch -0.40; landscape y 34, pitch -0.30) over dense jutaku and villa lanes south-west of the river,
looking north-north-east to the towers, with name tags on the nearest homes. The sun moved to the south-south-west
(~30° off the grid) so the street fronts this camera sees are lit and the side walls alternate.

## Measurable targets (checked with tools/sheet.py on the fixed vantage set)

- Luma std (contrast): suburb ≥ 0.17, downtown ≥ 0.14, hub ≥ 0.16.
- Mean saturation: suburb ≥ 0.25, downtown ≥ 0.20.

## Performance budgets (checked with tools/vantage.cjs → shots/<tag>/stats.json + perf.json)

perf.json is measured in this container (software GL): use it for **ratios between builds**, never as device fps.

| Vantage | Tris | Draws | GPU MB | Notes |
|---|---|---|---|---|
| phoneauto = the opening view (auto preset, Pixel 7, incl. the near shadow pass) | ≤ 60k portrait, ≤ 75k landscape | ≤ 22 | ≤ 6 | Round H: cast shadows come from one 12-tri shadow-only proxy per home. Round J: low-preset house ring r1 × 0.66 (≈ 400 m, was 0.62) — the round I 0.72 and its special 80k landscape row were dropped (optimization review). |
| Round M low tiers | as the rows above | ≤ 22 | ≤ 6 | Low preset: full (lite) houses to 1.12 r0, then 16x16-block massing tiles (one 30 m mass per row of homes, ~20 tris a block) out to ~700 m: tiles replace the simplified-house ring instead of adding to it; lite houses drop the eave band, lite poles carry one wire. |
| Every low vantage (round N) | | | | **Frame time: geoMs and allMs <= 1.10 x the last graded build** (median of 3 probes; compare two runs when a number moves > 20%, SwiftShader swings that much). The phone path takes no anisotropic filtering and fetches the atlas only inside window openings. |
| phone (low, 844x390) | ≤ 60k | ≤ 20 | ≤ 6 | ground pass ≤ 0.45× of `phonefull`. (Round 13 tried 75k for cast shadows on low; reverted: done correctly they cost 25–45% more tris.) Any low-preset camera, incl. chunk corners, ≤ 75k. |
| portrait (low, 390x844) | ≤ 75k | ≤ 20 | ≤ 6 | ground pass ≤ 0.45× of `portraitfull` |
| downtownlow (low) | ≤ 110k | ≤ 30 | ≤ 8 | |
| suburb / drone (high) | ≤ 490k | ≤ 50 | ≤ 35 | a Looks change adding > 5% tris needs a trade-off note |
| downtown / core / hub (high) | ≤ 520k | ≤ 85 | ≤ 35 | |

All vantages: allocations ≤ 8 KB/frame after warm-up (sampling heap profiler; `phoneauto`, the only vantage with name tags on, ≤ 10 KB while the probe turns the camera: the remainder is the browser's own style objects for ~15 moving DOM tags); boot to first frame ≤ 2 s here;
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

## Process (owner, round L) — overrides everything below

- **A round must raise each graded axis by >= 1.0.** A round that does not is not finished: its change is
  extended or replaced (or reverted) before the next round starts, and the reviewer must say why their
  prediction failed and widen the scope (a subsystem rewrite, not more tuning).
- **Reviewers propose, predict, then re-grade.** Each axis reviewer names 1-2 BIG changes and the score they
  will give when each is done (each must predict >= +1.5). Lists of small fixes are rejected.
- **The same reviewer re-grades** (continued, not respawned) so the scale stays calibrated; a fresh reviewer
  is used only to check that one is not drifting.
- All axes' big changes ship in the same round.

## Process (meta-review 2, round K) — supersedes conflicting rules below

- **The frame is frozen**: opening camera, sun (LOCKED above), wall/roof palettes and exposure as of round K.
  A reviewer note on any of these is discarded unless it comes as an OVERRIDE with before/after crops.
- **Structural rounds**: rounds L-N each carry one new visual capability, not a global parameter swing:
  L = occlusion (contact ramp on lit and shaded walls, side-wall gap occlusion, aerial perspective);
  M = a facade/roof texture atlas generated at load (window types with frames/reveals, roof tiles, mipmapped);
  N = fill the mid-band between the house ring and the towers.
- A Looks fix counts when it is visible in a 2× crop of a fixed region and wins an A/B, not by % of pixels.
- Design and Looks reviewers grade with the same anchors; complaints must name a material or technique.
- **Code moratorium**: no new robustness layers in main.js. The worker supervisor moves to a pure module with an
  injected clock and spawn, covered by a Node unit harness (death, hang, double death, back-off expiry, build
  superseded). Every code finding gets a failing test before its fix; tests are never deleted.

## Process (revised after meta-review, round F)

- `phoneauto` (what the owner sees on opening the page) weighs ≥ 50% of Looks and Design; show it at phone size
  next to the previous build. If no home is visible in the opening frame, Looks is capped at 5.
- A Looks fix counts only if it changes ≥ 15% of the `phoneauto` or `portrait` pixels, or is visible in a 2× crop.
- House micro-detail that is sub-pixel at the opening camera does not take a slot until Looks on `phoneauto` ≥ 7.
- Merge or delete process rules before adding new ones.

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
