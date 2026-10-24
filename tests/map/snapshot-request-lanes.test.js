import assert from 'node:assert/strict';
import { createSnapshotRequestQueue } from '../../src/map/isometric/client/data/request-queue.js';

const queue=createSnapshotRequestQueue(),pending=new Map();let active=0,peak=0;
const run=name=>signal=>new Promise((resolve,reject)=>{
  active++;peak=Math.max(peak,active);pending.set(name,{signal,complete:()=>{active--;resolve(name);},fail:()=>{active--;reject(signal.reason);}});
});
const a=queue.request({lane:'detail:one',run:run('a')}),b=queue.request({lane:'summary:one',run:run('b')});
const c=queue.request({lane:'adjacency:one',run:run('c')});assert.equal(queue.stats().queued,1);assert.equal(peak,2);
pending.get('a').complete();assert.equal(await a,'a');await Promise.resolve();await Promise.resolve();
assert.ok(pending.has('c'),'a third ordinary inspector operation waits for a physical slot');
const old=queue.request({lane:'search',run:run('old')}).catch(error=>error);
const next=queue.request({lane:'search',run:run('next')});assert.equal((await old).name,'AbortError');
pending.get('b').complete();await b;await Promise.resolve();await Promise.resolve();assert.ok(pending.has('next'));assert.ok(!pending.has('old'));
const replacement=queue.request({lane:'search',run:run('replacement')});const nextError=next.catch(error=>error);
assert.equal((await nextError).name,'AbortError');assert.equal(pending.get('next').signal.aborted,true);
assert.equal(queue.stats().running,2,'cancelled physical work retains its concurrency slot until it actually settles');
pending.get('next').fail();await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.ok(pending.has('replacement'));
pending.get('c').complete();pending.get('replacement').complete();await c;await replacement;assert.equal(peak,2);
queue.dispose();await assert.rejects(queue.request({lane:'after',run:run('after')}),/retired/);

const bounded=createSnapshotRequestQueue({inFlight:1,queued:1});
let finish;const held=bounded.request({lane:'held',run:signal=>new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',()=>resolve(null),{once:true});})}).catch(error=>error);
const deferred=bounded.request({lane:'queued',run:()=>null}).catch(error=>error);
await assert.rejects(bounded.request({lane:'overflow',run:()=>null}),/queue is full/);
bounded.dispose();assert.equal((await deferred).name,'AbortError');finish();assert.equal((await held).name,'AbortError');
console.log('Bounded source request lanes, supersession, physical settlement and queue retirement authored; hosts unqualified.');
