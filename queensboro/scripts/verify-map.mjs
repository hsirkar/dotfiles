import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const errors = [];
const failedRequests = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' || /GL_INVALID_OPERATION|Worker failed/.test(message.text())) errors.push(message.text());
});
page.on('requestfailed', request => failedRequests.push(request.url()));
const state = () => page.evaluate(async () => {
  const map = window.__atlasMap;
  return { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
});
try {
  await mkdir('artifacts', { recursive: true });
  await page.goto(process.env.MAP_URL || 'http://localhost:8080/');
  await page.waitForFunction(async () => {
    const map = window.__atlasMap;
    return map.loaded() && map.areTilesLoaded() && !!map.getLayer('babylon-places') && map.queryRenderedFeatures().length > 100;
  }, null, { timeout: 60000 });
  await expect(page.locator('.maplibregl-canvas')).toHaveJSProperty('clientWidth', 1440);
  await expect(page.locator('.maplibregl-canvas')).toHaveJSProperty('clientHeight', 900);
  await expect(page.locator('header, footer, .places, .intro, .map-controls, .view-switch')).toHaveCount(0);
  await page.waitForFunction(() => !!window.__atlasScene?.metadata?.bridge, null, { timeout: 30000 });
  const bridge = await page.evaluate(() => {
    const scene = window.__atlasScene;
    const mesh = scene.getMeshByName('queensboro-bridge-bridge-steel');
    return { ...scene.metadata.bridge, vertices: mesh?.getTotalVertices(), ready: mesh?.isReady() };
  });
  expect(bridge.lengthMeters).toBeGreaterThan(800);
  expect(bridge.lengthMeters).toBeLessThan(1500);
  expect(bridge.tileSpanCount).toBeGreaterThan(0);
  expect(bridge.vertices).toBeGreaterThan(1000);
  expect(bridge.ready).toBe(true);
  expect(bridge.widthSource).toBe('vector-tile-bridge-outline');
  expect(bridge.laneCount).toBe(null);
  expect(await page.evaluate(() => window.__atlasScene.materials.some(m => m.name === 'bridge-markings'))).toBe(false);
  expect(bridge.start[0]).toBeLessThan(bridge.end[0]);
  expect(bridge.start[1]).toBeGreaterThan(bridge.end[1]);
  console.log('PASS: Babylon Queensboro truss built from vector tile geometry', JSON.stringify(bridge));
  await page.screenshot({ path: 'artifacts/map-desktop.png' });
  await expect(page.locator('#map')).toHaveCount(1);
  expect(await page.evaluate(() => window.__atlasMap.getStyle().layers.some(layer => layer.type === 'fill-extrusion'))).toBe(false);
  const initial = await state();
  await page.mouse.move(900, 500);
  await page.mouse.down();
  await page.mouse.move(1060, 570, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await state()).center).not.toEqual(initial.center);
  await page.mouse.wheel(0, -450);
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(initial.zoom + 0.2);
  const beforeTilt = await state();
  await page.mouse.move(900, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1010, 540, { steps: 15 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await state()).pitch).not.toEqual(beforeTilt.pitch);
  await expect.poll(async () => (await state()).bearing).not.toEqual(beforeTilt.bearing);
  console.log('PASS: desktop tiles, Babylon layer, full-screen canvas, no custom UI, pan, zoom, tilt, rotation');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.maplibregl-canvas')).toHaveJSProperty('clientWidth', 390);
  await expect(page.locator('.maplibregl-canvas')).toHaveJSProperty('clientHeight', 844);
  await page.screenshot({ path: 'artifacts/map-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const crossings = [
    ['Brooklyn Bridge', [-73.9967, 40.706]],
    ['Manhattan Bridge', [-73.9905, 40.7095]],
    ['Williamsburg Bridge', [-73.9725, 40.7135]],
    ['George Washington Bridge', [-73.9527, 40.8517]],
    ['Macombs Dam Bridge', [-73.934, 40.8293]],
  ];
  for (const [name, center] of crossings) {
    await page.evaluate(center => window.__atlasMap.jumpTo({ center, zoom: 15.2, pitch: 58, bearing: -26 }), center);
    await page.waitForFunction(name => window.__atlasMap.loaded() && !!window.__atlasScene.metadata?.bridges?.[name], name, { timeout: 30000 });
    const info = await page.evaluate(name => window.__atlasScene.metadata.bridges[name], name);
    expect(info.widthSource).toBe('vector-tile-bridge-outline');
    expect(info.laneCount).toBe(null);
    expect(info.lengthMeters).toBeGreaterThan(100);
    await page.screenshot({ path: `artifacts/${name.toLowerCase().replaceAll(' ', '-')}.png` });
    console.log(`PASS: ${name}, tile-derived alignment and outline width, no invented lane count`);
  }
  // Returning to a crossing must retain one model, rather than duplicate it per tile load.
  await page.evaluate(() => window.__atlasMap.jumpTo({ center: [-73.9546, 40.7569], zoom: 15.2, pitch: 58, bearing: -26 }));
  await page.waitForFunction(() => window.__atlasMap.loaded());
  expect(await page.evaluate(() => window.__atlasScene.transformNodes.filter(node => node.name === 'queensboro-bridge').length)).toBe(1);
  await page.screenshot({ path: 'artifacts/map-desktop.png' });
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
  console.log('PASS: mobile canvas sizing, no JavaScript/WebGL errors, no failed network requests');
} finally {
  await browser.close();
}
