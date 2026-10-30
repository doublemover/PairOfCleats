import assert from 'node:assert/strict';
import { createGraphWorkerClient } from '../../src/map/isometric/client/data/worker-client.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

class WorkerDouble {
  static instance;
  constructor(){WorkerDouble.instance=this;this.sent=[];this.terminations=0;}
  postMessage(message){this.sent.push(message);if(message.kind==='init')queueMicrotask(()=>this.onmessage({data:{...message,event:'ready'}}));}
  terminate(){this.terminations++;}
  reply(message,value){this.onmessage({data:{protocol:MAP_DATA_PROTOCOL,snapshot:'source:a',request:message.request,revision:message.revision,kind:message.kind,event:'result',value}});}
}
let failures=0;
const client=createGraphWorkerClient({snapshot:'source:a',endpoint:'/map-snapshot',token:'fixture-token',WorkerImpl:WorkerDouble,onFailure:()=>failures++});
await Promise.resolve();assert.equal(client.ready,true);const worker=WorkerDouble.instance;
const first=client.request('search',{query:'first'},{revision:1});const firstRejected=assert.rejects(first,{name:'AbortError'});
const second=client.request('search',{query:'second'},{revision:2});await firstRejected;
const searches=worker.sent.filter(message=>message.kind==='search');worker.reply(searches[0],'stale');worker.reply(searches[1],'current');
assert.equal(await second,'current');
const detailOne=client.request('detail',{entity:{id:0}},{lane:'panel:one'}),detailTwo=client.request('detail',{entity:{id:'0'}},{lane:'panel:two'});
const independent=worker.sent.filter(message=>message.kind==='detail');assert.equal(independent.length,2);
worker.reply(independent[1],'string zero');worker.reply(independent[0],'numeric zero');
assert.equal(await detailOne,'numeric zero');assert.equal(await detailTwo,'string zero','separate source panels do not share a supersession lane');
const pending=client.request('layout',{}, {revision:3});const pendingRejected=assert.rejects(pending,/crash/);
const controller=new AbortController(),cancelled=client.request('detail',{}, {revision:4,signal:controller.signal});
const cancelledRejected=assert.rejects(cancelled,{name:'AbortError'});
const queued=client.request('adjacency',{}),queuedRejected=assert.rejects(queued,/crash/);
assert.equal(client.stats().queued,1,'ordinary third panel operation waits instead of failing at the transport concurrency limit');
controller.abort();await cancelledRejected;
worker.onerror({message:'worker crash',preventDefault(){}});await pendingRejected;await queuedRejected;
assert.equal(client.ready,false);assert.equal(worker.terminations,1);assert.equal(failures,1);
client.dispose();assert.equal(worker.terminations,1,'failed host retires once');
await assert.rejects(client.request('search',{}),/retired|not ready/);
console.log('Worker supersession, stale reply fencing, queue admission, abort and host retirement authored.');
