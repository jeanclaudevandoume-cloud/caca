# Follower Town — plan and handoff notes

This file started as the handoff plan written in an earlier session
(`claude/tiktok-follower-town-vonab1`). That session's code was never pushed (every push got
HTTP 403), so this branch re-implements the plan from its architecture, invariants and
roadmap. Sections 1–4 keep the original intent; sections 5–9 describe what this implementation
does and what is still open.

## 1. What the owner asked for (acceptance criteria)

A browser town in which **every TikTok follower owns a home**:

1. Same layout and looks on every run and every device.
2. Very optimized; must run on low-end phones.
3. Stunningly beautiful, vibrant style.
4. Built to scale as followers grow; hostable on a small server.
5. Many followers will have custom homes (special shapes, garden items), requested daily.
6. The user can fly around the city, and fly directly to anyone's home by searching their name.
7. The city is denser in the centre and has a port — "like Seoul or Tokyo".
8. **An independent reviewer rates the build out of 10 on optimization and on looks; keep
   upgrading from its reviews until it scores at least 9/10 on both.**

Item 8 is the definition of done. Inspiration only (no code or assets copied):
https://github.com/Noniv/abyssal-garden. We use WebGL2 for low-end reach.

## 2. Run it

```
npm run demo                      # 1M fake followers + ~30k customs -> data/demo -> public/town (~10 s)
PORT=8080 node server.mjs &       # http://localhost:8080
```

`public/town/` and `data/demo/` are generated and git-ignored. If layout rules in `town.js`
change (kinds, zones, river, lakes, plots per block), rerun `node tools/build.mjs data/demo`.

Screenshots: `timeout 115 node tools/shot.cjs <name> "<query>" [w h]` → `shots/<name>.png`
plus `window.__town.stats`. One browser at a time (SwiftShader is slow); look at every shot.
Frame rates in this container are software rendering and mean nothing.

### Vantage points (use these every round)

| Name | Query |
|---|---|
| downtown day / sunset / night | `q=high&t=10&notags` (+ `&tod=1`, `&tod=2`) |
| core street | `q=high&t=10&notags&cam=168,5,230,0,0.1` |
| suburb street | `q=high&t=10&notags&cam=2184,7,1260,0,-0.05` |
| hub mid-rise street | `q=high&t=10&notags&cam=3000,7,3000,0.9,-0.05` |
| mid altitude | `q=high&t=10&notags&cam=-900,450,-900,2.356,-0.45` |
| very high | `q=high&t=10&notags&cam=0,2500,-2500,3.14159,-0.75` |
| port on the bay | `q=high&t=10&notags&cam=1250,140,350,0.5,-0.25` |
| suburban custom home | `q=high&u=maxramen95643&instant&t=10` |
| downtown penthouse | `q=high&u=lunacat&instant&t=10` |
| low-end phone | `q=low&t=10&notags` at `844 390` |

## 3. Architecture

| File | Role |
|---|---|
| `public/js/town.js` | All rules: `hash3`, `riverZ`/`isRiver`, the bay and port (`bayAt`, `portLane`), avenues, lakes, `cellKind`, `zoneLevel`, `kindAt` (adds country, highways, open sea), plot frames, `homeRect`, `recipe`, `roofIdx`, layout order, `buildGround` (data texture for the ground shader), data keys. |
| `public/js/mesher.js` | `MB` builder + homes, customs, garden items, trees, lamps, parks, avenues, bridges, beacon, port, ships, skyline. |
| `public/js/worker.js` | Layout + chunk/skyline meshing off the main thread; fetches custom files. |
| `public/js/shaders.js` | Geometry (windows, night lights, canyon AO, fog), planar shadows, full-screen sky + ground. |
| `public/js/main.js` | GL, camera/input, streaming, time of day, governor, picking, search, fly-to, pin, tags. |
| `tools/build.mjs` | followers.txt + custom.json → manifest, region name files, custom files, search shards. |

### Invariants

1. **Determinism lives in `town.js`.** Integer math via `hash3`; `Math.sqrt` only on exact
   integers. No `Math.random`, time or GPU in any decision.
2. **Append-only growth.** Blocks are ordered by squared distance from the plaza (ties by
   hash); follower #n gets plot #n forever. `cellKind`, `zoneLevel`, `plotsIn` depend only on
   block coordinates. Country, highways, port and sea move outward as the town grows.
3. **The ground shader reads per-block facts from a data texture** built by `buildGround`
   (kind, zone, inhabited, avenues, district roof colours). It still mirrors by hand: `hash3`
   (per-slot roof pick), `riverZ`/`isRiver` and `bayHalf`/`bayAt`/`portLane` (outside the
   texture), plot layout and `ROOF`. Change both together.
4. **Vertex format** (`MB.v` ↔ `upload()`): int16 xyz ×64, uint8 u (m ×8), uint8 v (floors ×4,
   max 63), int8 normal, uint8 material (low 3 bits, +8 = tall), rgba8 (alpha = per-home byte).
   Index buffers are 16-bit when a mesh has < 65,536 vertices.
5. **Data:** 16 slots per block in region files (`lineIndex`), regions are 16×16 blocks.
   Mid-rise blocks hold 16 plots, all others 8.
6. No dependencies, build step, textures or model files.

### Rendering

- 48 m pitch (40 m block + 8 m road). Chunk = 4×4 blocks = one draw call.
- LOD0 < ~320 m (full detail, gardens, street trees, lamps), LOD1 < 1400 m (boxes + roofs;
  low homes sink into the ground between 72% and 96% of that radius), beyond that the
  full-screen shader paints roofs, shadows and night window specks, box-filtered by pixel
  footprint so the far field does not shimmer.
- Tall buildings hand over to per-region skyline meshes at 72% of the LOD1 radius. The
  decision is per chunk (computed from the vertex's chunk centre in the shader) so every
  vertex of a building agrees.
- Per frame: opaque chunks and skyline → full-screen sky/ground at depth 1 → planar shadows
  (stencil, multiply) for LOD0 casters.
- Quality: `quality.s` scales radii, `quality.pr` the pixel ratio; `governor()` adapts both in
  `auto` mode against the measured display refresh.

## 4. Roadmap from the original plan, and status here

| Item | Status |
|---|---|
| Arterial avenues and a river, mirrored in the shader | Done: avenues every 10 blocks, a 3-block river with bridges on every avenue. |
| District colour and readable far field | Done: per-district roof palettes, filtered painted roofs with shadows. |
| Darker night with warm windows | Done: dim filtered average, sparse lit windows, lamp pools, roof specks far away. |
| Cheaper full-screen pass on low quality | Partly: low quality skips noise, clouds and waves. Not rendered at reduced resolution. |
| Fewer skyline draws, instancing | Open. Skyline is one draw per 16×16-block region. |
| Port connected and nicer | Port has sawtooth warehouses, container stacks, gantry cranes, ships; a highway runs east to it. Rail open. |
| Tag occlusion, camera floor, phone layout | Done (sampled occlusion, collision with home heights, compact phone UI). |

## 5. Things not to do

- Do not fake or predict review results; only report scores a reviewer returned.
- Do not report fps from this container as device performance.
- Do not build a TikTok scraper or send follower names to outside services.
- Do not commit `public/town/`, `data/demo/` or `shots/`.
- Keep shapes procedural and original.

## 6. Review loop

Self-check the vantage points → commit → spawn a fresh, independent reviewer (read-only, with
the goals, run instructions, vantage table, previous scores) → act on its prioritized list →
log the round below. A new reviewer each round; never coach it toward a score.

## 7. Round log

| Round | Optimization | Looks | Notes |
|---|---|---|---|
| 1 (earlier session) | 6.5 | 5.5 | Code from that session was never pushed. |
| 2 (earlier session) | — | — | Reviewer died on a usage limit. |
| 3 | 7 | 6 | First review of this implementation. Bugs: tag blink, window speckle, footprint-less heights, undefined smoothstep on the pin, unclear penthouse framing. Looks: black night, grey downtown, spreadsheet from above, port far from the core, flat sunset. Opt: per-pixel rule hashing, altitude-blind LOD, Uint32 indices, global cache busting, duplicate custom fetches, sync server. |
| 3→4 changes | | | Bay + container port 1.2 km east of the plaza (river mouth), smooth river/bay shores with embankment parks, landmark tower cluster, warmer glass, light roof clutter, skyline crowns; per-building lit-window share, emissive lamps, lamp pools only on town streets; rim light at sunset. Ground data texture (no per-pixel rule hashing), horizon-only sky blend, 3D-distance LOD, Uint16 indices, per-file content hashes, customs fetched once, async LRU server, rounded trig. Tag name memo, footprint heights, pin fix, penthouse framing, search icon. Low quality: 257k→138k tris, 63→35 draws. |
| 4 | 7.5 | 6.5 | Verified most round-3 fixes. Open: lamp seam, hidden custom home, shadow cracks, bay staircase, brown night downtown, grid far field and zig-zag river, bare street level, flat sunset; low preset heavy in suburbs (trees), no draw sort, empty skyline jobs, no idle throttle, layout cost at 10M, manifest size. |
| 4→5 changes | | | Smooth sine river (integer table shared with the shader), jittered hubs of three sizes, promenade instead of roads along the bay. Shopfronts, awnings fixed to walls, lit signs, lobbies, varied roof plant, signature towers (stepped lantern crown + spire), aviation lights, lighter gables. Night: brighter far windows, early-lit windows at sunset, seamless lamp pools. Custom-home framing rises above obstacles. Opt: lite meshes on low (cheap trees, fewer props, no shadow pass: suburb 235k→83k tris), front-to-back sorting, empty skyline regions skipped, ~12 fps when idle, safe vertex culling. Declined for now: shadow hairline cracks (not reproduced), half-res ground pass, precomputed layout / split manifest. |
| 5 | 8 | 7 | Verified round-4 work. Open for Looks: little shadow grounding in the hero view, downtown colour/form (flat by day, orange at sunset, tan at night), far field still graph paper, port quay steps, empty bay, short sunset shadows. Open for Opt: layout rebuilt on every client (1.4 s / 244 MB at 10M), 40–54 skyline draws, lite flag not following quality, per-frame garbage, full-res ground pass, idle redraws, manifest size. |
| 5→6 changes (not yet reviewed) | | | Shadows by horizontal distance (650 m × quality) so the hero view casts them; sunset sun clamp 0.42→0.3; lanterns/lamps look like frosted glass by day; far night windows dimmer; lamp pools merge into a soft glow from altitude; chunks rebuild when lite-ness changes; no redraws when idle with frozen time. |

| 6 (strict) | 7.5 | 6.5 | Owner on a real phone: "works great, no lag, but the houses look cheap". Strict reviewer: houses get 26 tris each, painted-on windows, paper roofs, saturated candy palette, door slabs, neon grass, no tone curve. |
| 6→7 changes | | | Window assembly in the shader (frame, cross mullion, sill, lintel shadow, glass gradient, curtains), centred window grids, lap siding/brick/plinth by wall style, roof tile shader + fascia and ridge trim, 0.6 m eaves, rare flat roofs with parapets, front door assembly (frame, door, step, canopy, porch light), front hedges with path gaps, garden paths and contact AO painted on lots, brick/stucco townhouses with cornices and balconies, mid-rise signs/balconies/AC units, two-blob trees with dark undersides, earthy roof/wall palettes, ACES tone curve with a saturation lift, lower noon sun. Opt: LOD1 radius 1400→1100 m, skyline radius capped at 5 km, low homes in LOD1 don't cast shadows. |

| 7 (strict) | 7.5 | 7.0 | House fixes landed. Bugs: siding on mid-rises (wall-style bits), flat grey townhouse roofs, grey pincushion downtown, frosted signs. Opt unchanged: skyline draws, tree shadows, thin trim as boxes, layout on every client. |
| 7→8 changes | | | Layout: counting sort into typed arrays (same order; 1M 143→57 ms, 10M ~1.4 s→0.45 s). Skyline tiles 2×2 regions at 1/32 m (draws 53→18 downtown). Trees cast through an 8-face proxy (suburb casters 19.5k→7.3k/chunk). Fascia and doors as single quads; lite chunks 12.2k→5.3k. Wall style fixed per zone (panel spandrels for mid-rises), 65% gabled townhouses with parapets and stair huts, four tower facades (ribbon, fins, stone, bronze) + dark glass, per-tower night glow, warm key / cool shade, signs keep colour and show lettering, sloped thin awnings, AC units on street faces, parked cars, window reveals, curtains 1/8, softened custom colours, mowing stripes and grass variation, district tints, painted shadows on low, clamped lamp pools, lighter fog and exposure. |

| 8 (strict) | 8.0 | 7.0 | Two rounds without a significant Looks gain → meta-review. |
| meta | — | — | Grading unreliable: reviewers re-decided the palette each round (round 6 prescribed near-white walls, round 8 blamed them), anchoring on previous scores, different vantages, no target. Fixes landed below visibility (suburb luma std fell 0.19→0.12). Root causes: no value structure, flat lighting (~2.5:1, diagonal sun), a default view that hides house-scale work, many small fixes with no acceptance test. New process: ART.md (frozen AD + rubric with sub-scores), fixed vantage set captured before/after (tools/vantage.cjs + tools/sheet.py metrics), reviewers don't see previous scores, ≤5 fixes with acceptance tests. |
| 8→9 changes | | | AD frozen in ART.md: mid-value warm palettes with dark facades and dark glass, exposure 1.0 + sat 1.08, noon sun [1.3,1.15,0.95] / sky [0.30,0.38,0.55], azimuth 25° off grid, far blue fog. Canyon shade 0.45→1 over 30 m, sun-averted ×0.8, per-building jitter (downtown contrast 0.116→0.142, hub 0.151→0.163, sunset 0.147→0.176). New opening view across the river into the core. Night floor bands, glow capped. Stacked projecting signs and overhead wires in mid-rise streets. Stair-hut material bug fixed; earlier detail fade on low (moiré). Opt: prebuilt order.bin (identical layout, 270 KB gz at 1M; clients skip the sort), lite drops city props, frame loop allocates no matrices/arrays. |

| 9 (rubric) | 8 | 5.5 | First round on the ART.md rubric, previous scores hidden (new, stricter scale). 5 fixes with acceptance tests. |
| 9→10 changes | | | Roofs darkened (OVERRIDE accepted: frozen roofs broke the V table) — suburb roof V 0.53/0.47 ✓. CITY palette clamped to S≤.30/V≤.85 and accent walls blended into it — 0/10,432 mid-rise walls out of limits ✓. House plinth, 0.9 m eaves with dark soffit and coloured fascia, block garden walls with gate posts — suburb chunk 31.1k ≤ 31.7k ✓, lite 6.5k ≤ 6.9k ✓. Signature crown only d≤1 & roll<6 (2 towers) ✓. Night: far per-floor bands, glow ×0.6, dark glass, 7–39% lit — night core mean luma 0.132 ≤ .17 ✓, 70% dark ✓. Opening view: the reviewer's (150,60,420) gave a cluttered pincushion, so it is down the central avenue over the bridge to the beacon (−30,70,560) instead. Low skyline lite (≥12 floors, no crowns): downtown low 189k→101k tris ✓, portrait 67k. Not met: suburb contrast 0.163 (<.17), downtown contrast 0.133 and night 0.14 on the new opening frame (large calm water/sky areas; targets were set on the old frame). |

| 10 (rubric) | 8 | 6.5 | +1.0 Looks on the rubric scale. Caught developer slips: stats.json overwritten by a partial capture, invalid house camera (inside an eave), roof target loosened in a code comment without OVERRIDE. |
| 10→11 changes | | | Windows stretched to whole cells per wall (no corner wrap). Soffit shade(wall,.75), parapet sides darker + light coping. Side wings with garage doors on ~55% of suburban homes, porches on 30% (suburb chunk 33.8k ≤ 34k, lite 6.9k ≤ 7.2k). Bridge: dark deck, sidewalks, 1.1 m railings, lane dashes, 8 lamps per span. River/bay deep teal, less sky mix. Portrait camera closer. Roofs clamped to the ART table (S ≤ .45, V ≤ .42) and the ground shader now reads ROOF from JS (uniform) — no hand-copied palette. Process fixes: vantage stats merge across partial runs; house camera moved out of the eave; roof comment corrected. Measured: downtown contrast .133→.149 ✓ (≥.14), portrait .102→.127; suburb .163→.153 and drone .179→.162 fell (roof desaturation per ART + wings covering lawn/shadow) — trade-off left for the reviewer. |

| 11 (rubric) | 8 | 6.0 | Developer bug: wing code inserted into the roof else-if chain → 22% of near suburban homes roofless (hip+wing) and hidden parapets under gables; wing LOD pop; clamped roofs read mauve. Opt flat for 3 rounds → second meta-review. |
| meta (opt) | — | — | Optimization stalled because no slot went to it since round 9 while Looks work added 5–10% tris on high; 4 of 6 sub-scores were unmeasurable; **the 8→9 claim "frame loop allocates no matrices/arrays" was not true** (todState, vectors, closures, strings still allocated). New: perf probe (pass timings via forced sync, boot ms, KB downloaded, KB/frame via sampling heap profiler), budget table in ART.md, one slot reserved for the lagging axis, "done" only when measured. |
| 11→12 changes | | | Roof chain restored (0% roofless; chunk 32.0k, lite 5.8k), wing drawn at every LOD (no pop), warm roofs darker/browner, tile courses ×0.25, wires only between mid-rise blocks. Half-resolution ground pass on low: phone ground 170→49 ms (0.29×), frame 204→77 ms; portrait ground 181→46 ms, frame 283→131 ms; mean pixel diff < 1/255. Frame-loop allocations measured 26.4 → 4.2 KB/frame (preallocated time-of-day state, vectors, frustum test without closures, allocation-free hypot/sort/radii). Portrait camera experiment (y 38, z 290) reverted: a tower filled half the frame. |

| 12 (rubric) | 7.5 | 6.0 | Budgets now measured: hub 36 MB over, full-res boot over 2 s. Half-res ground erased road markings (mean-diff metric was blind to it). Two rounds without significant gain on both axes → meta-review 3. |
| meta 3 | — | — | The loop stopped changing what the owner sees: phone vantage r9→r12 only 7% of pixels moved (mostly roof hue). Causes: no grounding/eave shade on low, single boxes, generic-suburb identity, LITE strips craft, palette drifted to mud, tests became proxies (tri budgets, palette compliance). Direction: a "diorama" pass baked into geometry so the low preset gets it. Process: grade the low preset first (≥40%), gating question "would the owner still call these houses cheap?", ≤1 metric-only acceptance, one structural-bet slot judged by phone A/B, frozen cameras. |
| 12→13 changes | | | Half-res footprint fix (uPx): crosswalks/lane lines back at half res (visual check). Diorama pass: baked eave shade band (vertex colours, every preset), light corner boards (outward faces only), fascia kept on lite, bigger door, house shadows on the phone preset from the nearest 120 m, roof saturation OVERRIDE to S ≤ .60. A/B on lowclose/lowdrone/house: visible (eave band, corner boards, shadows, warmer roofs) but pixel change below the 25% bar (lowclose 9%, phone 4%). Cost: phone 50k→70k tris (budget raised to 75k as an explicit trade-off), phone frame 1.16×; portrait 71k ≤ 75k; suburb chunk 34.9k, lite 9.0k. |

| 13 (revised process) | 6.5 | 5.5 | Low preset graded first. Gating question: owner would still call the houses cheap on a phone — YES (LITE strips the craft, one box + garage, eave band too weak). Phone shadows were camera-lucky: culled by chunk-centre distance, so houses near chunk corners cast nothing. Suburb 502k and hub 532k/37 MB over budget. Verdict on the diorama pass: revise. |
| 13→14 changes | | | Shadow culling uses distance to the chunk's bounding square (bug fix). Correct phone shadows cost 25–45% more tris (corner camera 94.5k), so cast shadows on the low preset were reverted to the painted ground shadows; corner boards dropped on lite. Measured: phone 55.4k, lowclose 63.9k, portrait 68.4k, chunk-corner camera 70.9k — all within budget; phone frame 83 ms (r12 77 ms). |

### Where this stands (honest)
After 8 strict rounds and 3 meta-reviews, Looks sits around 5.5–6.5 on the strict rubric and Optimization 6.5–8.
The meta-reviews agree that incremental detail on flat procedural boxes has hit its ceiling around 6–6.5;
reaching 9 needs a structural art change (a real house kit with varied massing on every preset, or a deliberate
stylization such as a miniature/diorama look), judged on the phone by the owner.

## Four-reviewer rounds (code / design / optimization / overall looks)

| Build | Code | Design | Optimization | Looks | Notes |
|---|---|---|---|---|---|
| r15 (phone build fixed) | 6.5 | 5.2 | 7.0 | 5.5 | Bundling bug broke the phone build since round 6; fixed; scoped bundler, phonetest, selftest. |
| round A | — | 5.0 | — | 5.0 | Tokyo/Seoul kit + optimization tiers. Looks dipped: colour removed with nothing to replace it, opening view lost its story. (code/opt reviewers hit a usage limit) |
| round B | 7.5 | 5.5 | 7.0 | 5.5 | Packed houses, roof mix, colour carriers, avenue opening view. Opt found 2.9x phone fill regression. |
| round C | 7.5 | 6.0 | 8.0 | 5.5 | Neutral shade, concrete lots, side-wall services, cheap phone window path, zero-area tris removed, tested hysteresis. |
| round D | 7.5 | 5.7 | 8.0 | 5.7 | Window language per house + centre mullion + lintel; baked value (darker ground storey, shade sides, near-black garages, jitter, stronger painted shadow); roof palette w/o green on jutaku; tategaki sign lettering (integer hash); height-weighted fog; one LOWQ switch (dead code removed, same window hash); no MSAA on phones; lazy shader compile; vantage capture fails loudly. |
| round E | 7.0 | 4.0 | 7.0 | 3.5 | Shared winLayout (blank side walls, wide ground sliders, balcony doors), recess shadow; upper storeys cantilever over the garage and 3-storey homes step back; galvalume roofs; LITE billboards; avenue traffic; idle precompile of the other shader variant; `phoneauto` vantage = real Pixel 7 auto path. Code and Looks flat for 3 rounds, so a meta-review runs this round. Scores fell because reviewers graded the real phone opening view (`phoneauto`) for the first time: it showed zero homes. |
| meta (round E) | | | | | Root causes: the graded phone vantages were not the opening view; house micro-detail was sub-pixel at the opening camera; no cast shadows on low; far skyline plain boxes; the rubric rewarded compliance, not appeal. |
| round G (this build) | | | | | Opening view over homes with name tags; sun SSW so fronts are lit; near cast shadows on low (trade-off logged in ART.md); painted shadows to drone distance; far tower floor lines and value spread; worker respawn + stale sweep; context-loss camera restore; search seq guard; name sanitising; stats.mb counts textures. |

### Next steps, in priority order
1. Precompute the block order at build time (compact binary in `public/town/`), so clients don't run `buildLayout` (scaling to 10M on phones).
2. Merge skyline regions per distance ring; reuse matrix/array buffers per frame.
3. Downtown colour and night readability; far-field macro variation; straight or diagonal port quay; bay depth and foam.
4. Half-resolution ground pass on low quality.
5. Then run review round 6 with a fresh reviewer.
