# Atlas

An interactive NYC map built entirely from a downloaded OpenStreetMap snapshot. MapLibre GL JS renders local GeoJSON land, water, roads, railways, parks, labels, and 3D buildings. Babylon.js shares the map WebGL context to render procedural bridges, elevated approaches, and three terracotta place markers. No external basemap style, vector tiles, glyph service, or click-time Overpass query is used.

## Run

```sh
npm install
# First setup: install osmium-tool (macOS: brew install osmium-tool).
npm run cache:nyc -- --download
python3 -m venv .venv-osm
.venv-osm/bin/python -m pip install -r scripts/osm-requirements.txt
npm run cache:map
npm run dev
```

Open the URL printed by Vite. `npm run check` checks TypeScript; `npm run build` produces `dist/`.

The map fills the viewport; clicking a building opens its OSM inspector. Drag to pan, scroll to zoom, and right-drag (or Ctrl-drag) to rotate and tilt. Touch supports pan, pinch, and two-finger rotation.

After initial setup, the map can run from the local server without internet. All map geometry and fonts are served from this project. No API key or external map provider is required. MapLibre displays OpenStreetMap attribution. The three markers use simple Babylon primitives; no external 3D assets are used. Coverage is limited to the downloaded NYC-area rectangle; the camera is bounded to that area.

References: [MapLibre Babylon integration](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-babylonjs/), [OSM bulk downloads](https://wiki.openstreetmap.org/wiki/Downloading_data), [Osmium export](https://docs.osmcode.org/osmium/latest/osmium-export.html).

## Browser verification

With the development server running on port 8080, run `npm run verify` to check map loading, desktop gestures, mobile sizing, and browser errors using Playwright Chromium. Install the browser once with `npx playwright install chromium`. Screenshots are saved in `artifacts/`. `npm run verify:local` additionally blocks every external HTTP request and checks local land/water, roads, labels, building clicks, bridges/approaches, overview zoom, and mobile rendering.

## Bridges and data limits

As local chunks load while navigating, Babylon renders recognized Manhattan crossings, including Queensboro, Brooklyn, Manhattan, Williamsburg, George Washington, and Harlem River bridges. The renderer consumes complete OSM bridge road ways from the local dataset, identifies crossings using their original names, and uses coastline-derived water and inland water polygons to distinguish river spans from elevated approaches. Mapped `man_made=bridge` outlines provide widths where available; otherwise widths use an approximate fallback. The existing procedural silhouettes still approximate each crossing with a straight principal axis. Models persist as viewport chunks change.

There are no lane markings or inferred lane counts. OSM road lines describe carriageways and do not establish lane counts. Deck elevations, tower locations, piers, and structural profiles are approximate visualization choices, not engineering data extracted from the snapshot. Queensboro uses a cantilever silhouette; Brooklyn, Manhattan, Williamsburg, and George Washington use suspension silhouettes; other crossings use simple decks and piers. These are lightweight procedural Babylon meshes, not surveyed models.

Structural references: [NYC DOT Queensboro](https://www.nyc.gov/html/dot/html/infrastructure/queensboro-bridge.shtml), [NYC DOT Manhattan](https://www.nyc.gov/html/dot/html/infrastructure/manhattan-bridge.shtml), [NYC DOT Williamsburg](https://www.nyc.gov/html/dot/html/infrastructure/williamsburg-bridge.shtml), [NYC DOT Brooklyn](https://www.nyc.gov/html/dot/html/infrastructure/brooklyn-bridge.shtml), [Port Authority George Washington](https://portfolio.panynj.gov/2016/05/17/george-washington-bridge-a-new-defense-system-against-corrosion/).

## Road surfaces

Babylon draws only modeled bridge decks and the connected approach road segments that ramp down to the basemap. The snapshot road graph determines connectivity, with grade separation retained; nearby unrelated streets stay on the MapLibre basemap. At the ramp's ground-level endpoint, the Babylon road ends and the basemap continues. All road/path classes are eligible for connections, but only segments reached by the bridge approach solver are drawn. No extra OSM data is fetched.

Chunk changes are batched, and road/bridge rebuilding waits until camera movement stops. Bridge-area road source geometry is retained for the life of the scene, independent of viewport chunk eviction. Panning away and back does not remove or recreate previously loaded roads. Existing meshes remain visible while panning and until a replacement containing new geometry has rendered. Repaint-only frames do not rebuild the road graph. Roads outside the maximum bridge-approach reach are rejected before graph construction; only reached approach segments are subdivided for smooth slopes. If there are no bridge-connected segments in the loaded snapshot geometry, no Babylon road mesh is created.

The surface uses an explicit metric `width` attribute if provided. Otherwise it uses a uniform 6 m **cartographic stroke**, not a claim about the road's physical width or number of lanes. There are no lane markings or inferred lane counts. The 0.45 m vertical offset prevents overlap with the basemap; it is a rendering offset, not elevation data. These parameters live in `src/config.ts`.

## Bridge approaches

Roads on the bridge footprint meet the modeled deck surface. Connecting OSM polylines ramp smoothly back down through a snapped road graph, with grade separation retained by the OSM `layer` and tunnel tags. Aligned endpoints can join when an approach changes layer. Deck geometry and road attachment share one elevation profile, including the two modeled levels at Queensboro and George Washington. Reached ramp segments are subdivided after solving connectivity on original tile vertices; connected junctions share elevations. The default maximum visual grade is 8%, configurable in `src/config.ts`. These are estimated approach elevations, not surveyed OSM heights. No extra OSM data is fetched.

Road mesh revisions depend on newly cached bridge-area geometry and bridge profile changes, not viewport chunk removals. A partial update cannot replace an existing approach mesh with an empty mesh. The retained road batch uses the shared map projection for clipping to avoid whole-batch disappearance from camera culling.

## NYC buildings: local data, no click-time Overpass

Buildings are rendered from downloaded OSM geometry, with their original way/relation IDs and all source tags attached. Clicking a building reads those tags directly from the rendered feature. It makes **no Overpass request** and performs **no footprint matching** against OpenFreeMap buildings. The other basemap layers and road/bridge visualization now also use the same local OSM snapshot.

Previously we rendered third-party building tiles, then queried Overpass around a clicked footprint and tried to match its geometry to OSM. That introduced network latency, rate limits, and ambiguous matches. The current building layer and inspector share the same OSM records, eliminating that identification step. The old `src/osm-building.ts` lookup utility is retained but is not used by the map or inspector; `VITE_OVERPASS_URL` does not affect the current building click path.

### Download and prepare

The source is [BBBike's NewYork regional extract](https://download.bbbike.org/osm/bbbike/NewYork/NewYork.osm.pbf), a snapshot of **all current OSM features** in its region, not just buildings. Its [region boundary](https://download.bbbike.org/osm/bbbike/NewYork/NewYork.poly) spans approximately longitude -74.36 to -73.67 and latitude 40.48 to 40.96, covering NYC and nearby areas. It is a regional rectangle, not the administrative five-borough boundary, and does not include full object edit history. Regional bulk extracts are the approach described in the [OSM downloading guide](https://wiki.openstreetmap.org/wiki/Downloading_data).

Requirements: Python 3.11+, `curl`, and the `osmium` CLI (`brew install osmium-tool` on macOS).

```sh
# Download the complete regional PBF and build static building chunks:
npm run cache:nyc -- --download

# Rebuild using the PBF already on disk, without downloading again:
npm run cache:nyc

# Build the app, including the generated static files:
npm run build
```

`scripts/cache-nyc-buildings.py` keeps the full extract at `data/osm/NewYork.osm.pbf`. It uses `osmium tags-filter` to retain buildings, building parts, and polygonal bridge piers/towers, including referenced geometry, then `osmium export` to assemble polygons and multipolygon relations. Original OSM type, ID, and tags are preserved. Malformed or incomplete geometries that Osmium cannot assemble are omitted; their objects remain in the original PBF.

The generated `public/nyc-buildings/` contains a manifest and 0.01-degree geographic JSON chunks. Footprints crossing cell boundaries are included in each intersecting cell; the browser deduplicates them by OSM type/ID. Geometry is stored as longitude/latitude coordinates with holes and multipolygons preserved.

Initial snapshot: OSM timestamp **2026-10-16 23:00 UTC**, 153 MB source PBF, **1,623,997 building-related polygon records**, 2,689 chunks, about **578 MB uncompressed generated JSON**. These counts include surrounding areas and building parts, not just distinct NYC buildings. The largest initial chunk is about 1.42 MB. These figures will change when refreshed.

The PBF and generated chunks are gitignored. A fresh checkout must run the preparation command before buildings appear; deployment must include the generated files. Vite copies `public/` into `dist/` during the production build. Refreshing the extract does not delete or filter the original all-feature PBF, so roads and other layers can be processed from it later.

### Rendering, clicks, and offline scope

`src/nyc-buildings.ts` loads chunks intersecting the viewport when movement stops, starting at zoom 14. It supplies a GeoJSON source to the `buildings-3d` extrusion layer. Each rendered feature carries `osm_type`, `osm_id`, serialized `osm_tags`, and the snapshot timestamp. `src/building-inspector.ts` displays the original tags, a direct OSM object link, render properties, and expandable geometry. Background click, Escape, or × closes the inspector.

Extrusion height uses OSM `height` when available, otherwise `building:levels × 3 m`, otherwise an 8 m display default. Base height uses `min_height` or `building:min_level × 3 m`. Simple meter and foot values are supported. Estimates appear only in render properties (`height_source`), never as invented OSM tags. This is a basic extrusion visualization, not detailed roof or architectural reconstruction.

`src/nyc-building-cache.ts` fetches same-origin static files, keeps up to 16 chunks in memory, and stores visited chunks plus the manifest in browser Cache Storage (`queensboro-nyc-buildings-v1`). A source-file hash versions building chunk URLs. After reloading, the manifest is revalidated; previously visited chunks can be read from browser storage if the network is unavailable. Missing snapshot coverage or a failed chunk load does not trigger an Overpass fallback in the current renderer.

Building and basemap data can run **without internet when served locally**. Only visited chunks are cached in browser storage, which may be evicted or unavailable. Application assets and fonts are not precached by a service worker, so disconnecting from a remote host and reopening the page is not guaranteed to work. A running local server can serve any NYC chunk and all application assets from disk. S3/CloudFront deployment would likewise serve static files rather than execute spatial queries.

### Refresh and verify

For the MVP, manually rerun `npm run cache:nyc -- --download`, then `npm run cache:map`, rebuild, deploy, and reload the page. Keep the existing dataset available while preparing a refresh. Publish the manifest and chunks together; the current flat output layout is intended for simple deployments, not seamless concurrent version rollouts. Continuous OSM replication is not configured.

With the dev server running:

```sh
MAP_URL=http://localhost:8080/ npm run verify:nyc
```

This browser check verifies snapshot building rendering, exact OSM identity and tags on click, browser-cache reuse with the network disabled, and zero Overpass requests. It saves `artifacts/nyc-cache.png`. Install Chromium with `npx playwright install chromium` if needed.

Data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distributed under ODbL 1.0. Preserve attribution and the applicable database license when redistributing the processed data.

## Local basemap preparation

`npm run cache:map` runs `scripts/cache-nyc-map.py` with the project virtual environment and reuses `data/osm/NewYork.osm.pbf`; it does not download the source again. The additional Python dependency is Shapely, pinned in `scripts/osm-requirements.txt`. All geometry originates in that PBF.

The script filters and exports road ways, railways, waterways, water polygons, land use, parks/leisure areas, named places, selected named POIs, and bridge outlines. It preserves original OSM identities and relevant styling/bridge tags. Buildings and their full tags continue to use the separate building chunks above. The original full PBF retains features not selected for rendering, including other POIs and administrative boundaries.

OSM coastlines are open, directed ways rather than ready-to-fill sea polygons. The processor joins/nodes them with the extract boundary, polygonizes the result, classifies land using OSM's land-on-the-left convention, and derives coastal water as the regional rectangle minus land. Inland water polygons are added separately. Malformed/incomplete OSM relations can be omitted by Osmium; the output is a basic regional visualization, not a complete cartographic replacement for a maintained commercial basemap.

Generated `public/nyc-map/` contains:

- `manifest.json`: source/processor hash, OSM timestamp, bounds, cell size, occupied cells, and feature counts.
- `overview.json`: regional coastline land/water, inland water, large landcover, simplified roads grouped by class for distant views, complete bridge road ways/outlines, and named places.
- `x_y.json`: 0.02-degree detail chunks containing complete minor/major road geometry, railways, smaller landcover, waterways, and selected POIs. Crossing features are duplicated across cells and deduplicated by ID in the browser.

The initial basemap contains 674,437 road features, 14,581 railway features, 3,259 waterways, 129,061 landuse/leisure polygons, 2,765 inland water polygons, 1,863 bridge outlines, 806 named places, and 4,222 selected named POIs. These counts cover the full regional extract, including surrounding areas. There are 778 detail chunks; the overview is about 13.9 MB and all basemap files total about 401 MB uncompressed. This is an intentionally simple MVP format with a sizeable initial overview download; use HTTP compression when hosting it. Both generated map directories are gitignored and must be prepared before building/deploying.

`src/local-map.ts` defines the style and viewport loader. The overview loads once; detail chunks load after movement stops at zoom 13+. Roads switch from grouped overview lines to original detailed road features at that zoom. It keeps up to 64 detail chunks in memory and stores visited files in browser Cache Storage (`queensboro-nyc-map-v1`) using versioned URLs. Refreshing the page revalidates the manifest. Land/water and major roads remain visible when zoomed out; building extrusions start at zoom 14, road names at zoom 15, and selected POI names at zoom 16.

Labels use the locally bundled Noto Sans font in `public/fonts/`, licensed under the accompanying SIL Open Font License. There is no remote glyph URL, sprite sheet, or map style. Roads use cartographic pixel widths and simple hierarchy styling, not inferred physical lane widths. Railways and POIs have deliberately basic styling; terrain elevation, imagery, complex road shields, detailed roofs, and universal POI iconography are outside this MVP.

Babylon receives whole-feature road/outline/water geometry through `mapFeatures()` rather than querying MapLibre's internally clipped GeoJSON render buckets. Bridge IDs/tags and road geometry come from the snapshot; approach grades, principal-axis simplification, deck profiles, towers, and cables remain visualization estimates. Geometry is retained around discovered bridges as the camera moves.

### Potential expansion to the planet

The same model scales conceptually: **download/process once, render by stable OSM identity, read tags directly on click**. A planet dataset would require a different preparation and delivery pipeline; changing the download URL alone is insufficient.

1. Download a current `planet.osm.pbf` from an OSM bulk-data mirror. Use a machine with enough SSD scratch space and memory to filter objects and assemble relations. Benchmark a larger regional extract before sizing a planet job.
2. Preserve OSM type/ID throughout processing. Replace the NYC-wide overview and fixed JSON grids with regional packages and zoom-dependent simplification. Static GeoJSON packages can preserve the no-downloaded-vector-tiles approach, but efficient zoom-aware vector tiles/PMTiles are another option if that constraint changes. Never load a global overview containing every detailed road into a browser.
3. Keep selected render attributes and stable identity in map geometry. Either include all tags where size permits or store full tag records in separately sharded static files keyed by OSM type/ID. The latter adds a direct cached record fetch, not a spatial search or Overpass query.
4. Host immutable, versioned regional packages and tag shards in object storage/CDN, loading only visible regions and requested records. Publish a small release manifest after all assets are uploaded, retaining older releases while clients finish using them. Use a robust global coastline-processing pipeline and validate boundary joins between packages.
5. Start with scheduled snapshot rebuilds. Add OSM replication diffs and incremental geometry/tag updates only when freshness requirements justify the operational work. Monitor build failures, incomplete relations, CDN costs, and browser cache size.

Planet coverage does not require running an Overpass server for this use case. It does require substantially larger offline processing and storage, efficient regional delivery, and an update strategy. The full planet must never be downloaded into each user's browser.
