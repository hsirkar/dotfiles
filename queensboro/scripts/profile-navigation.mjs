import { chromium } from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:process.env.MAP_GPU==='metal'?['--use-angle=metal']:[]});const page=await browser.newPage({viewport:{width:1440,height:900}});
try{
 await page.goto(process.env.MAP_URL || 'http://localhost:8081/');
 await page.waitForFunction(()=>window.__atlasMap?.loaded()&&window.__atlasScene?.getMeshByName('queensboro-bridge-bridge-steel')?.isReady() && (window.__atlasScene.metadata.world?.mode!=='precomputed'||window.__atlasScene.metadata.world.pendingChunks===0),null,{timeout:120000});
 await page.evaluate(()=>{
  window.__profile={frames:[],tasks:[],updates:0,active:true};
  new PerformanceObserver(list=>{window.__profile.tasks.push(...list.getEntries().map(e=>e.duration))}).observe({type:'longtask',buffered:false});
  let previous=performance.now();const tick=now=>{if(!window.__profile.active)return;window.__profile.frames.push(now-previous);previous=now;requestAnimationFrame(tick)};requestAnimationFrame(tick);
  for(const source of Object.values(window.__atlasMap.style.sourceCaches||{})){void source;}
  for(const id of Object.keys(window.__atlasMap.getStyle().sources)){const source=window.__atlasMap.getSource(id);if(source.setData){const original=source.setData.bind(source);source.setData=(...args)=>{window.__profile.updates++;return original(...args)}}}
 });
 await page.mouse.move(900,450);await page.mouse.down();await page.mouse.move(1080,520,{steps:40});await page.mouse.up();
 await page.waitForFunction(()=>window.__atlasMap.loaded()&&!window.__atlasMap.isMoving(),null,{timeout:60000});
 const initialZoom=await page.evaluate(()=>window.__atlasMap.getZoom());
 await page.mouse.wheel(0,-300);
 await page.waitForFunction(z=>window.__atlasMap.getZoom()>z+.1,initialZoom);
 await page.waitForFunction(()=>!window.__atlasMap.isMoving()&&window.__atlasMap.loaded(),null,{timeout:60000});
 const result=await page.evaluate(()=>{const p=window.__profile;p.active=false;const f=p.frames.sort((a,b)=>a-b);const gl=window.__atlasMap.painter.context.gl;const debug=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),frames:f.length,p50:f[Math.floor(f.length*.5)],p95:f[Math.floor(f.length*.95)],maxFrame:f.at(-1),longTasks:p.tasks.length,longTaskMs:p.tasks.reduce((a,b)=>a+b,0),maxLongTask:Math.max(0,...p.tasks),setDataCalls:p.updates}});
 console.log(JSON.stringify(result));if(process.env.PROFILE_OUTPUT)await writeFile(process.env.PROFILE_OUTPUT,JSON.stringify(result,null,2));
}finally{await browser.close()}
