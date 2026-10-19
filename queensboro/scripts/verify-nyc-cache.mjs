import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: process.env.MAP_GPU === 'metal' ? ['--use-angle=metal'] : [] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const requests = [];
page.on('request', request => requests.push(request.url()));
try {
  await page.goto(process.env.MAP_URL || 'http://localhost:8080/');
  await page.waitForFunction(() => window.__atlasMap?.getLayer('buildings-3d') && window.__atlasMap.queryRenderedFeatures({ layers: ['buildings-3d'] }).length > 10, null, { timeout: 60000 });
  const selected = await page.evaluate(() => {
    const map = window.__atlasMap;
    for (let y=200;y<750;y+=25) for(let x=200;x<1250;x+=25) {
      const point={x,y}, feature=map.queryRenderedFeatures(point,{layers:['buildings-3d']})[0];
      if(!feature)continue;
      map.fire('click',{point,lngLat:map.unproject([x,y])});
      return {type:feature.properties.osm_type,id:feature.properties.osm_id,embeddedTags:feature.properties.osm_tags};
    }
  });
  expect(selected).toBeTruthy();
  expect(selected.embeddedTags).toBeUndefined();
  const manifest=JSON.parse(await readFile('public/nyc-tiles/manifest.json','utf8'));
  const records=JSON.parse(await readFile(`public/nyc-tiles/${manifest.tags}${selected.id%256}.json`,'utf8'));
  const expected=records[`${selected.type}/${selected.id}`];
  expect(expected).toBeTruthy();
  await expect(page.locator('.building-inspector-osm > a')).toHaveAttribute('href',`https://www.openstreetmap.org/${selected.type}/${selected.id}`);
  await expect(page.locator('.building-inspector-osm h3')).toHaveText(`OSM tags (${Object.keys(expected).length})`);
  const shown=await page.locator('.building-inspector-osm dl').evaluate(dl=>Object.fromEntries([...dl.querySelectorAll('dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent])));
  expect(shown).toEqual(expected);
  await page.evaluate(async()=>{
    const {BuildingTags,loadTileManifest,assetUrl}=await import('/src/tile-data.ts');
    window.__tagsClass=BuildingTags; window.__tileManifest=await loadTileManifest();window.__tagRoot=assetUrl(window.__tileManifest.tags);
  });
  await page.waitForFunction(async shard=>{
    const cache=await caches.open('queensboro-vector-data-v1');return !!await cache.match(window.__tagRoot+shard+'.json');
  }, selected.id%256);
  await context.setOffline(true);
  const offline=await page.evaluate(async selected=>new window.__tagsClass(window.__tileManifest).get(selected.type,selected.id,new AbortController().signal),selected);
  expect(offline).toEqual(expected);
  expect(requests.filter(url=>/overpass.*\/api\//.test(url))).toEqual([]);
  expect(requests.some(url=>url.includes('/nyc-map/')||url.includes('/nyc-buildings/'))).toBe(false);
  await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/nyc-cache.png'});
  console.log(`PASS: tile building identity, ${Object.keys(expected).length} exact original tags, ID-keyed offline reuse, no embedded tag dictionary or Overpass`);
}finally{await browser.close()}
