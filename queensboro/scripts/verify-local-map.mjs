import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const external = [], errors = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    external.push(url.href);
    return route.abort();
  }
  return route.continue();
});
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(process.env.MAP_URL || 'http://localhost:8080/');
  await page.waitForFunction(() => {
    const map = window.__atlasMap;
    return map?.getLayer('buildings-3d') && map.loaded() && map.queryRenderedFeatures({ layers: ['buildings-3d'] }).length > 10 && window.__atlasScene?.metadata?.bridge;
  }, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__atlasMap.queryRenderedFeatures({ layers: ['place-labels', 'road-labels'] }).length > 0);
  const state = await page.evaluate(() => {
    const map = window.__atlasMap;
    return { sources: Object.values(map.getStyle().sources).map(source => source.type),
      roads: map.queryRenderedFeatures({ layers: ['local-roads', 'major-roads'] }).length,
      land: map.queryRenderedFeatures({ layers: ['land'] }).length,
      labels: map.queryRenderedFeatures({ layers: ['place-labels', 'road-labels'] }).length,
      bridge: window.__atlasScene.metadata.bridge, approaches: window.__atlasScene.metadata.roads };
  });
  expect(state.sources.every(type => type === 'geojson')).toBe(true);
  expect(state.roads).toBeGreaterThan(100);
  expect(state.land).toBeGreaterThan(0);
  expect(state.labels).toBeGreaterThan(0);
  expect(state.bridge.source).toBe('nyc-osm-snapshot');
  expect(state.bridge.lengthMeters).toBeGreaterThan(800);
  expect(state.bridge.lengthMeters).toBeLessThan(2000);
  expect(state.approaches.elevatedPointCount).toBeGreaterThan(0);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/local-map-home.png' });
  const click = await page.evaluate(() => {
    const map = window.__atlasMap;
    for (let y = 200; y < 750; y += 30) for (let x = 200; x < 1250; x += 30) {
      const point = { x, y };
      const feature = map.queryRenderedFeatures(point, { layers: ['buildings-3d'] })[0];
      if (!feature) continue;
      map.fire('click', { point, lngLat: map.unproject([x, y]) });
      return `https://www.openstreetmap.org/${feature.properties.osm_type}/${feature.properties.osm_id}`;
    }
  });
  await expect(page.locator('.building-inspector-osm > a')).toHaveAttribute('href', click);
  await page.evaluate(() => window.__atlasMap.jumpTo({ center: [-73.9967, 40.706], zoom: 15, pitch: 50, bearing: -15 }));
  await page.waitForFunction(() => {
    const map = window.__atlasMap;
    return map.loaded() && map.queryRenderedFeatures({ layers: ['local-roads'] }).length > 100 && window.__atlasScene.metadata.bridges?.['Brooklyn Bridge'];
  }, null, { timeout: 60000 });
  await page.screenshot({ path: 'artifacts/local-map-brooklyn.png' });
  await page.evaluate(() => window.__atlasMap.jumpTo({ center: [-73.98, 40.74], zoom: 11, pitch: 0, bearing: 0 }));
  await page.waitForFunction(() => window.__atlasMap.loaded());
  await page.screenshot({ path: 'artifacts/local-map-overview.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__atlasMap.jumpTo({ center: [-73.9546, 40.7569], zoom: 15.2, pitch: 58, bearing: -26 }));
  await page.waitForFunction(() => window.__atlasMap.loaded() && window.__atlasMap.queryRenderedFeatures({ layers: ['buildings-3d'] }).length > 10);
  await page.screenshot({ path: 'artifacts/local-map-mobile.png' });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS: local land/water, roads, labels, buildings, bridges/approaches, pan/zoom, mobile; zero external requests/errors', JSON.stringify(state));
} finally { await browser.close(); }
