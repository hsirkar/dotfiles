# Atlas

A small interactive East River map built with TypeScript, Vite, MapLibre GL JS, OpenMapTiles-schema vector tiles served by OpenFreeMap, and a Babylon.js custom layer sharing the map's WebGL context. Babylon renders the three terracotta place markers and bridge geometry; MapLibre renders the flat basemap. Building extrusion is disabled.

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite. `npm run check` checks TypeScript; `npm run build` produces `dist/`.

The map fills the viewport with no custom interface overlays. Drag to pan, scroll to zoom, and right-drag (or Ctrl-drag) to rotate and tilt. Touch supports pan, pinch, and two-finger rotation.

Tiles and labels require an internet connection. No API key or environment configuration is required. Map attribution is displayed by MapLibre. The three markers intentionally use simple Babylon primitives; no external 3D assets are used.

References: [MapLibre Babylon integration](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-3d-model-with-babylonjs/), [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles schema](https://openmaptiles.org/schema/).

## Browser verification

With the development server running on port 8080, run `npm run verify` to check map loading, desktop gestures, mobile sizing, and browser errors using Playwright Chromium. Install the browser once with `npx playwright install chromium`. Screenshots are saved in `artifacts/`.

## Bridges and data limits

As tiles load while navigating, Babylon renders recognized Manhattan crossings, including Queensboro, Brooklyn, Manhattan, Williamsburg, George Washington, and Harlem River bridges. The renderer joins tile-clipped `transportation` lines tagged `brunnel=bridge`, identifies crossings using `transportation_name`, and uses `water` polygons to distinguish river spans from long approach roads. Bridge outline polygons provide widths when available; otherwise widths use an approximate fallback. Models persist as tiles unload and expand when new tiles reveal more of a crossing.

There are no lane markings or inferred lane counts. Road lines in these tiles describe carriageways and do not establish lane counts. Deck elevations, tower locations, piers, and structural profiles are approximate visualization choices, not engineering data extracted from the tiles. Queensboro uses a cantilever silhouette; Brooklyn, Manhattan, Williamsburg, and George Washington use suspension silhouettes; other crossings use simple decks and piers. These are lightweight procedural Babylon meshes, not surveyed models.

Structural references: [NYC DOT Queensboro](https://www.nyc.gov/html/dot/html/infrastructure/queensboro-bridge.shtml), [NYC DOT Manhattan](https://www.nyc.gov/html/dot/html/infrastructure/manhattan-bridge.shtml), [NYC DOT Williamsburg](https://www.nyc.gov/html/dot/html/infrastructure/williamsburg-bridge.shtml), [NYC DOT Brooklyn](https://www.nyc.gov/html/dot/html/infrastructure/brooklyn-bridge.shtml), [Port Authority George Washington](https://portfolio.panynj.gov/2016/05/17/george-washington-bridge-a-new-defense-system-against-corrosion/).
