# Follower Town

A browser town in which every follower owns a home. Fly around a dense, Seoul/Tokyo-style
city (tower core, mid-rise ring, townhouses, garden suburbs, hub sub-centres, a wide river with
bridges, avenues, parks, lakes and a container port), search anyone by name and fly straight to
their home.

- **Deterministic.** The layout and every home's look are pure integer functions of block
  coordinates (`public/js/town.js`). Same town on every run and every device.
- **Append-only.** Follower #n gets plot #n forever; new followers move in further out.
- **Light.** No dependencies, no build step, no textures or models. WebGL2, one draw call per
  4×4-block chunk, three levels of detail (full, simple, painted by a full-screen shader),
  per-region skyline meshes for tall buildings, adaptive quality for phones.
- **Static hosting.** The town is plain files: `public/` can be served by any static host.

## Run the demo

```
npm run demo          # 1,000,000 fake followers + ~30k custom homes -> data/demo -> public/town
npm start             # http://localhost:8080
```

## Real followers

TikTok's official API exposes the follower *count*, not the list, so the town holds followers
who opt in (for example through a form you run). Keep them in:

- `data/live/followers.txt` — one name per line, in follow order. Append only. When someone
  leaves, blank their line instead of deleting it, so everyone after them keeps their home.
- `data/live/custom.json` — custom homes:

```json
{
  "lunacat":  { "shape": "mushroom", "color": "#ff4f7b", "garden": ["flowers", "pond"] },
  "max_wolf": { "shape": "castle", "color": "#9aa7c7", "garden": ["statue", "tree"] }
}
```

Shapes: mushroom, dome, castle, pyramid, ufo, treehouse, lighthouse, igloo, rocket, cube.
Garden items: fountain, pool, flowers, tree, car, trampoline, statue, bench, swing, pond, palm, tent.
In the dense city a custom home becomes a rooftop penthouse.

Then `npm run build` and upload `public/`. The build only rewrites files whose content changed,
and open browsers pick up the new manifest within five minutes.

## URL parameters

`q=high|low|auto` · `tod=0.22` day, `1` sunset, `2` night · `t=10` freezes animation time ·
`notags` hides name tags · `cam=x,y,z,yaw,pitch` · `u=<name>` (or `#u=<name>`) flies to a
follower, add `instant` to jump · `debug` shows a stats line.

## Layout of the code

| File | Role |
|---|---|
| `public/js/town.js` | Cell and zone rules: hash, block kinds, zones, plots, streaming decisions. |
| `public/js/layout.js` | Layout order (follower <-> plot), layout file, data file keys, ground texture. |
| `public/js/recipe.js` | Home recipes and palettes. |
| `public/js/names.js` | Name normalisation, search shards, build-time name cleaning. |
| `public/js/mesher.js` | Chunk, mid-band and skyline meshes (the worker's entry points). |
| `public/js/mb.js` | Mesh builder (16 bytes/vertex), the shared palettes and mesh tile sizes. |
| `public/js/props.js` | Trees, wires, lamps, kanban, billboards, custom shapes, doors, rooftop clutter. |
| `public/js/homes.js` | Homes on their plots, shop houses, civic cells, tower massing. |
| `tools/poptest.cjs` | Flythrough pop metric (fixed-pose frame pairs on a virtual 60 fps clock). |
| `public/js/worker.js` | Builds layout and meshes off the main thread. |
| `public/js/shaders.js` | Geometry, planar shadows, full-screen sky/ground (mirrors `town.js`). |
| `public/js/main.js` | GL, camera, streaming, time of day, search, fly-to, tags, adaptive quality. |
| `tools/build.mjs` | followers + customs -> `public/town/`. |
| `tools/demo-data.mjs` | Fake followers. |
| `tools/shot.cjs` | Headless screenshots for checking changes. |
| `server.mjs` | Zero-dependency static server with gzip and ETags. |

See `plan.md` for the design notes, invariants and the review log.
