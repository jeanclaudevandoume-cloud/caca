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

### Next steps, in priority order
1. Precompute the block order at build time (compact binary in `public/town/`), so clients don't run `buildLayout` (scaling to 10M on phones).
2. Merge skyline regions per distance ring; reuse matrix/array buffers per frame.
3. Downtown colour and night readability; far-field macro variation; straight or diagonal port quay; bay depth and foam.
4. Half-resolution ground pass on low quality.
5. Then run review round 6 with a fresh reviewer.
