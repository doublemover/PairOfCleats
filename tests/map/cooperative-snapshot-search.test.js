import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

const model={version:MAP_MODEL_VERSION,nodes:Array.from({length:1500},(_,row)=>({path:`dir${row%2}/${row}.ts`,members:[{id:row===1499?0:`opaque:${row}:😀`,name:`symbol${row}`}]})),edges:[]};
const transport=createMapSnapshotTransport({model,snapshotId:'pinned:cooperative',maxResponseBytes:8192});
const request={protocol:MAP_DATA_PROTOCOL,snapshot:'pinned:cooperative',request:1,revision:7,kind:'search',query:'symbol',cursor:0,limit:80};
let yields=0;const asyncPage=JSON.parse(await transport.respondAsync(request,{yieldControl:async()=>{yields++;}}));
const syncPage=JSON.parse(transport.respond(request));assert.deepEqual(asyncPage,syncPage);assert.ok(yields>0);assert.equal(asyncPage.total,1500);
for(const fields of [{query:'😀'},{query:' symbol ',directory:'dir1',entityType:'member'},
  {query:'dir0',entityType:'file'},{query:'absent',directory:'dir0'},{query:'',entityType:'file',cursor:1490,limit:10}]){
  const scoped={...request,...fields};
  assert.deepEqual(JSON.parse(await transport.respondAsync(scoped)),JSON.parse(transport.respond(scoped)),
    'cooperative and compatibility paths share source order, exact scope and continuation');
}
for(const fields of [{entityType:'render-slot'},{directory:{}},{query:'x'.repeat(4097)}]){
  assert.throws(()=>transport.respond({...request,...fields}));
  await assert.rejects(transport.respondAsync({...request,...fields}));
}
const end=JSON.parse(await transport.respondAsync({...request,cursor:1499,limit:1}));assert.equal(end.rows[0].id,0);assert.equal(end.next,null);
const controller=new AbortController();await assert.rejects(transport.respondAsync(request,{signal:controller.signal,yieldControl:async()=>controller.abort()}),error=>error.name==='AbortError');
const aborted=new AbortController();aborted.abort();let afterAbortYields=0;
await assert.rejects(transport.respondAsync(request,{signal:aborted.signal,yieldControl:async()=>{afterAbortYields++;}}),error=>error.name==='AbortError');
assert.equal(afterAbortYields,0,'pre-aborted source work never starts scanning');
const anonymous=createMapSnapshotTransport({model:{version:MAP_MODEL_VERSION,nodes:[{path:'anonymous.ts',members:Array.from({length:1000},()=>({name:'no canonical member identity'}))}],edges:[]},snapshotId:'pinned:anonymous'});
let anonymousYields=0;const anonymousPage=JSON.parse(await anonymous.respondAsync({...request,snapshot:'pinned:anonymous',query:''},{yieldControl:async()=>{anonymousYields++;}}));
assert.ok(anonymousYields>0,'non-searchable anonymous source rows also yield without gaining fabricated identities');assert.equal(anonymousPage.total,1);anonymous.dispose();
await assert.rejects(transport.respondAsync({...request,cursor:1501}),/matching total/);
const retiring=createMapSnapshotTransport({model,snapshotId:'pinned:retiring'});
await assert.rejects(retiring.respondAsync({...request,snapshot:'pinned:retiring'},{yieldControl:async()=>retiring.dispose()}),error=>error.name==='AbortError');
transport.dispose();console.log('Adopted cooperative source-wide search preserves page identity/totals, original IDs and actual cancellation; no service/latency acceptance.');
