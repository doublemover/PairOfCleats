import assert from 'node:assert/strict';
import { createRenderLoop } from '../../src/map/isometric/client/render-loop.js';
import { updatePerfStats } from '../../src/map/isometric/client/telemetry.js';

const pending=new Map();let id=0,visible=true,active=false;const frames=[];
const loop=createRenderLoop({visible:()=>visible,request:callback=>{pending.set(++id,callback);return id;},cancel:key=>{pending.delete(key);},
  render:(time,context)=>{frames.push({time,...context});return active;}});
const tick=time=>{const [key,callback]=pending.entries().next().value;pending.delete(key);callback(time);};
loop.invalidate();loop.invalidate();assert.equal(pending.size,1);
tick(1);assert.equal(pending.size,0,'static scene owns no recurring RAF');
active=true;loop.invalidate();tick(10);assert.equal(pending.size,1);tick(26);assert.equal(frames.at(-1).continuous,true);
visible=false;loop.visibilityChanged();assert.equal(pending.size,0);
loop.invalidate();assert.equal(pending.size,0,'hidden invalidations remain dirty without scheduled work');
visible=true;active=false;loop.visibilityChanged();tick(100000);assert.equal(frames.at(-1).continuous,false);
assert.equal(pending.size,0);loop.dispose();loop.invalidate();assert.equal(pending.size,0);
const stats={slowCallbacks:1};
updatePerfStats({perfStats:stats,now:100000,frameMs:99974,budgetMs:18,intervalValid:false,fpsState:{start:0,frames:3}});
assert.equal(stats.slowCallbacks,1,'resume/idle gap is not a slow render callback');
assert.equal(stats.callbackIntervalMs,null);assert.equal(stats.fps,null);assert.equal(stats.gpuMs,null);
console.log('Static/hidden render ownership and telemetry distinguish active callback intervals from suspension.');
