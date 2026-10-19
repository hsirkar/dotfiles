# Atlas

An interactive NYC map rendered from a downloaded OpenStreetMap snapshot. Planetiler reads OSM PBF directly and builds local vector tiles in a PMTiles archive. MapLibre renders the basemap and extruded buildings; Babylon.js renders precomputed bridges, approach roads, and three terracotta place markers. No external basemap provider, API key, remote glyph service, or click-time Overpass query is required.

## Run

Requirements: Node.js, Java 21+, Python 3.11+, `curl`, and the Osmium CLI (`brew install osmium-tool` on macOS).

```sh
npm install
python3 -m venv .venv-osm
.venv-osm/bin/python -m pip install -r scripts/osm-requirements.txt
npm run tiles:build -- --download
npm run dev
```

The first tile build downloads the [BBBike NewYork extract](https://download.bbbike.org/osm/bbbike/NewYork/NewYork.osm.pbf) and pinned [Planetiler 0.10.2](https://github.com/onthegomap/planetiler/releases/tag/v0.10.2). Subsequent `npm run tiles:build` runs reuse the PBF on disk. Add `-- --download` to refresh it. Builds reuse prepared assets when their source/processor fingerprint is unchanged. `npm run check` checks TypeScript; `npm run build` produces `dist/`, including generated public assets.

Open the URL printed by Vite. Click a building for its OSM tags. Drag to pan, scroll to zoom, and right-drag (or Ctrl-drag) to rotate and tilt; touch supports pan, pinch, and two-finger rotation. The camera is bounded to the downloaded NYC-area rectangle.

## Data preparation and rendering

The source is a regional snapshot of all current OSM features, including surrounding areas, rather than an administrative five-borough boundary or object edit history. Its bounds are approximately longitude -74.36 to -73.67 and latitude 40.48 to 40.96. Bulk regional downloads follow the [OSM downloading guide](https://wiki.openstreetmap.org/wiki/Downloading_data). The original PBF retains objects that the rendering profile does not select.

`scripts/tiles/build.py` coordinates three offline steps:

1. `prepare-coastline.py` uses Osmium and Shapely to assemble the extract's directed coastlines into land and ocean polygons. This small build-time GeoJSON is needed to fill the sea; it is not a browser map source.
2. `NycTiles.java` is a custom Planetiler profile that reads the PBF directly. It creates land, landuse, water, waterway, road, rail, building, place, and POI vector layers at zooms 10–16. Higher display zooms overzoom those tiles. It preserves OSM type/ID and selected render attributes, and writes full building tags into separate ID-keyed shards. Buildings and roads do not pass through a full GeoJSON export before tiling.
3. `build-world.ts` runs the bridge and road approach builders once with Babylon's NullEngine. It consumes whole OSM features exported only for the bridge corridor, then writes binary vertex/index buffers for bridges and 2 km approach chunks. The browser downloads and uploads these meshes as needed; it does not solve road connectivity or construct bridge geometry while navigating.

Generated data lives under `public/nyc-tiles/releases/<fingerprint>/`: `nyc.pmtiles`, 256 `tags/*.json` shards, `world/manifest.json`, binary world meshes, and build statistics. The small root `manifest.json` is published last and pins all components to the same release. Input PBF, build scratch files, and generated public data are gitignored. A fresh checkout must build these assets before the map can load.

The initial source snapshot is **2026-10-16 23:00 UTC**: approximately 153 MB PBF, 215 MB PMTiles, **1,624,057 building tag records** (including building parts and surrounding areas), and 5 MB of bridge/approach mesh data covering 15 recognized bridges and 20 approach chunks. Tag shards add storage beyond the archive. Counts and sizes change with new snapshots and profile changes. This profile is a basic regional visualization: it does not render every OSM tag or feature category, terrain, imagery, detailed roofs, road shields, or universal POI icons. Incomplete or invalid geometries can be omitted during processing.

`src/local-map.ts` defines the vector style. MapLibre fetches only tiles needed for the viewport and zoom, simplifies/clips rendering through its tile pipeline, and retains its own tile cache. There are no viewport-wide GeoJSON `setData` calls. Labels use the locally bundled Noto Sans font and its accompanying SIL Open Font License in `public/fonts/`.

## Building clicks without Overpass

Previously, a clicked third-party building footprint triggered a spatial Overpass query and an attempt to match that footprint to an OSM object. Both latency and ambiguous matches came from that extra step.

Buildings now render from the downloaded OSM dataset itself. Each vector feature includes its original `osm_type` and `osm_id`. `src/building-inspector.ts` uses those identifiers to fetch the exact original tags from a static shard selected by `id % 256`; records are keyed by `way/id` or `relation/id`. There is no spatial search, footprint matching, or Overpass fallback. All source tags remain available without repeating them in every clipped tile. The inspector also displays a direct OSM object link, snapshot timestamp, render properties, and expandable rendered geometry. Tile geometry may be clipped or simplified; it is not a full original-object geometry export.

Extrusion height uses OSM `height`, otherwise `building:levels × 3 m`, otherwise an 8 m display default. Base height uses `min_height` or `building:min_level × 3 m`. Simple meter/foot values are supported. Estimates appear as render attributes, never as invented OSM tags.

## Bridges and approaches

Complete source road ways, bridge outlines, and coastline/inland water polygons drive offline bridge placement. Recognized crossings include Queensboro, Brooklyn, Manhattan, Williamsburg, George Washington, and Harlem River bridges. Mapped `man_made=bridge` outlines provide widths where available; fallback widths are approximate. Queensboro uses a cantilever silhouette; major suspension crossings use approximate suspension silhouettes, and other crossings use simple decks/piers.

The road graph connects bridge decks to approach segments and ramps back to the basemap, preserving grade separation using OSM layer/tunnel tags. Decks and connected approaches share elevation profiles, including the modeled Queensboro and George Washington levels. Unrelated streets remain on the basemap. Width uses an explicit metric OSM width when available, otherwise a uniform 6 m cartographic stroke. There are no inferred lane counts or lane markings. The 0.45 m rendering offset and default maximum visual grade of 8% are configurable in `src/config.ts`.

Deck elevations, tower locations, piers, cables, principal-axis simplification, and approach grades are visualization estimates, not surveyed engineering data. The offline world export currently covers the Manhattan bridge corridor (-74.05, 40.65 to -73.85, 40.90); expanding modeled bridges requires adjusting this region and recognition/configuration. The full regional basemap is independent of this narrower model coverage.

`src/precomputed-world.ts` loads nearby static meshes with bounded concurrency, retains loaded chunks, and changes their visibility during movement. Returning to a crossing reuses the same model. Bridge/road builder modules remain available for the offline build, outside the browser rendering path.

## Hosting, offline use, and refreshes

Serve the generated files with the app. A local server can run the entire map without internet after preparation. PMTiles requires HTTP byte-range responses (`206 Partial Content`); the host must support them, and cross-origin hosting also requires suitable CORS headers. Vite supports local range requests. Static object storage/CDN such as S3/CloudFront can serve the archive, shards, and mesh files without a spatial query server. Do not apply whole-file HTTP compression to the PMTiles archive; tile compression is internal and byte offsets must remain usable. JSON shards can use HTTP compression.

`src/tile-data.ts` stores visited PMTiles byte ranges, tag shards, and world assets in browser Cache Storage (`queensboro-vector-data-v1`), with immutable release URLs. It keeps four parsed tag shards in memory. The root manifest is revalidated, with a cached fallback when unavailable. Browser storage can be evicted; unvisited regions are not downloaded in advance. There is no service worker precaching application files/fonts, so reopening a remotely hosted app while disconnected is not guaranteed. Serving from a running local server provides all regional data from disk.

To refresh, run `npm run tiles:build -- --download`, rebuild the app, and deploy the complete generated release before its root manifest. Retain old release URLs while existing clients may still use them; remove obsolete release directories deliberately after that window to control storage and deployment size. Continuous OSM replication is not configured.

## Verification

Install Chromium once with `npx playwright install chromium`. With the local development server running:

```sh
MAP_URL=http://localhost:8080/ npm run verify
MAP_URL=http://localhost:8080/ npm run verify:local
MAP_URL=http://localhost:8080/ npm run verify:nyc
MAP_URL=http://localhost:8080/ npm run profile
```

`verify` checks loading, bridge/road meshes, pan/zoom/tilt, mobile sizing, and browser errors. `verify:local` blocks external HTTP traffic and checks local map layers, building inspection, overview zoom, and bridges. `verify:nyc` compares clicked tags to their exact sidecar record, checks cache reuse with the network disabled, and rejects Overpass/old GeoJSON requests. Screenshots are saved in `artifacts/`.

`profile` measures frame intervals, long tasks, and GeoJSON `setData` calls during a fixed pan/zoom gesture. On macOS, use `MAP_GPU=metal` to exercise native Metal rather than Playwright's default software renderer; results depend on browser/GPU, viewport, and cache state. Avoid comparing software-rendered frame rates with hardware-rendered runs.

## Potential planet expansion

The architecture remains **bulk PBF → vector tiles plus exact ID-keyed tags → cached viewport rendering**. A planet dataset does not require an Overpass instance for building clicks, but changing the PBF URL alone is insufficient:

1. Benchmark larger extracts and provision a batch machine with sufficient RAM, SSD scratch space, and build time for Planetiler's node/relation processing and tile sorting. Current fixed 6 GB Java heap and NYC bounds are regional settings.
2. Replace NYC coastline assembly with a validated global coastline pipeline, and generalize geographic bounds and the currently local bridge model builder. Preserve original OSM type/ID throughout processing.
3. Keep small render attributes in tiles. Increase tag shard granularity or use a record-serving index so a single click cannot require a planet-sized shard. Partition regional archives where useful for distribution and updates.
4. Host immutable archives, tags, and mesh assets in object storage/CDN with range support. Publish version manifests after assets are ready; validate coverage, relation assembly, and package boundaries. Browsers download only visible tiles and requested records.
5. Start with scheduled snapshot rebuilds. Add replication diffs/incremental updates only if freshness requirements justify the additional infrastructure and validation.

Data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distributed under ODbL 1.0. Preserve attribution and applicable database licensing when redistributing processed data. References: [Planetiler](https://github.com/onthegomap/planetiler), [PMTiles](https://docs.protomaps.com/pmtiles/), [Osmium](https://osmcode.org/osmium-tool/), and [MapLibre Babylon integration](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-babylonjs/).
