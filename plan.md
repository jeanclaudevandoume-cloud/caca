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
| port | `cam=portX-300,95,-440,2.136,-0.26` (`portX = __town.layout.portX`, 11040 at 1M) |
| suburban custom home | `q=high&u=maxramen95643&instant&t=10` |
| downtown penthouse | `q=high&u=lunacat&instant&t=10` |
| low-end phone | `q=low&t=10&notags` at `844 390` |

## 3. Architecture

| File | Role |
|---|---|
| `public/js/town.js` | All rules: `hash3`, `riverZ`/`isRiver`, avenues, lakes, `cellKind`, `zoneLevel`, `kindAt` (adds country, highways, port, sea), plot frames, `recipe`, `roofIdx`, layout order, data keys. |
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
3. **The ground shader mirrors `town.js` by hand** (`hash3`, `riverZ`, `isRiver`, `lakeAt`,
   `cellKind`, `kindAt`, `zoneLevel`, `roofIdx`, plot layout, `ROOF`). Change both together.
4. **Vertex format** (`MB.v` ↔ `upload()`): int16 xyz ×64, uint8 u (m ×8), uint8 v (floors ×4,
   max 63), int8 normal, uint8 material (low 3 bits, +8 = tall), rgba8 (alpha = per-home byte).
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
