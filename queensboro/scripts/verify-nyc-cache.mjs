import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const overpass = [];
page.on('request', request => { if (/overpass.*\/api\//.test(request.url())) overpass.push(request.url()); });
try {
  await page.goto(process.env.MAP_URL || 'http://localhost:8080/');
  await page.waitForFunction(() => window.__atlasMap?.getLayer('buildings-3d') &&
    window.__atlasMap.queryRenderedFeatures({ layers: ['buildings-3d'] }).length > 10, null, { timeout: 60000 });
  const selected = await page.evaluate(() => {
    const map = window.__atlasMap;
    for (let y = 200; y < 750; y += 25) for (let x = 200; x < 1250; x += 25) {
      const point = { x, y };
      const feature = map.queryRenderedFeatures(point, { layers: ['buildings-3d'] })[0];
      if (!feature) continue;
      map.fire('click', { point, lngLat: map.unproject([x, y]) });
      return { type: feature.properties.osm_type, id: feature.properties.osm_id,
        tags: JSON.parse(feature.properties.osm_tags) };
    }
  });
  expect(selected).toBeTruthy();
  await expect(page.locator('.building-inspector-osm > a')).toHaveAttribute('href',
    `https://www.openstreetmap.org/${selected.type}/${selected.id}`);
  await expect(page.locator('.building-inspector-osm')).toContainText('NYC snapshot');
  for (const key of Object.keys(selected.tags)) {
    await expect(page.locator('.building-inspector-osm dt').filter({ hasText: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toHaveCount(1);
  }
  const warm = await page.evaluate(async () => {
    const { NycBuildingCache } = await import('/src/nyc-building-cache.ts');
    window.__CacheClass = NycBuildingCache;
    const data = await new NycBuildingCache().lookup(-73.96, 40.75, -73.955, 40.755, new AbortController().signal);
    return data.elements.map(e => `${e.type}/${e.id}`).sort();
  });
  expect(warm.length).toBeGreaterThan(100);
  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    const data = await new window.__CacheClass().lookup(-73.96, 40.75, -73.955, 40.755, new AbortController().signal);
    return data.elements.map(e => `${e.type}/${e.id}`).sort();
  });
  expect(offline).toEqual(warm);
  expect(overpass).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/nyc-cache.png' });
  console.log(`PASS: rendered snapshot buildings, exact OSM tags on click, ${offline.length} cached buildings available offline, zero Overpass requests`);
} finally {
  await browser.close();
}
