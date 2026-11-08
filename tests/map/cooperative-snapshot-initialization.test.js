import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { createMapSnapshotTransport, createMapSnapshotTransportAsync } from '../../tools/analysis/map-snapshot-transport.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

const model={version:MAP_MODEL_VERSION,root:{id:'recorded'},nodes:[{path:'dense/one.ts',members:Array.from({length:1300},(_,row)=>({id:row,name:`symbol${row}`}))},
  {path:'other/two.ts',members:[]}],edges:Array.from({length:1300},(_,row)=>({from:{file:'dense/one.ts',member:row},to:{file:'other/two.ts'},type:'call'}))};
const input={model,snapshotId:'pinned:initialization'}, sync=createMapSnapshotTransport(input);
let yields=0;
const cooperative=await createMapSnapshotTransportAsync(input,{yieldControl:async()=>{yields++;}});
assert.ok(yields>=10,'a single dense file yields for its members as well as its relationship rows');
assert.deepEqual(cooperative.manifest,sync.manifest);
const request={protocol:MAP_DATA_PROTOCOL,snapshot:input.snapshotId,request:1,revision:0,kind:'files',cursor:0,limit:80};
for(const fields of [{},{kind:'members',fileRow:0},{kind:'edges'},{kind:'resolve',entity:{type:'member',id:0}},
  {kind:'adjacency',entity:{type:'member',id:0}},{kind:'adjacency-summary',entity:{type:'file',file:'dense/one.ts'}}]){
  const operation={...request,...fields};
  assert.deepEqual(await cooperative.respondAsync(operation),sync.respond(operation),'both startup paths retain exact address/order/summary authority');
}
const summary={...request,kind:'adjacency-summary',entity:{type:'file',file:'other/two.ts'}};
let summaryYields=0;
const counted=JSON.parse(await cooperative.respondAsync(summary,{yieldControl:async()=>{summaryYields++;}}));
assert.ok(summaryYields>0);assert.equal(counted.incoming,1300);assert.equal(counted.outgoing,0);assert.equal(counted.total,1300);
const stopSummary=new AbortController();
await assert.rejects(cooperative.respondAsync(summary,{signal:stopSummary.signal,yieldControl:async()=>stopSummary.abort()}),error=>error.name==='AbortError');
const stopBuild=new AbortController();let buildYields=0;
await assert.rejects(createMapSnapshotTransportAsync(input,{signal:stopBuild.signal,yieldControl:async()=>{buildYields++;stopBuild.abort();}}),error=>error.name==='AbortError');
assert.equal(buildYields,1);assert.equal(model.nodes[0].members.length,1300);assert.equal(model.edges.length,1300,'partial cleanup never clears borrowed source arrays');
const before=new AbortController();before.abort();let visited=0;
await assert.rejects(createMapSnapshotTransportAsync(input,{signal:before.signal,yieldControl:async()=>{visited++;}}),error=>error.name==='AbortError');
assert.equal(visited,0);
await assert.rejects(createMapSnapshotTransportAsync(input,{yieldControl:async()=>{throw new Error('inert scheduler stopped');}}),/scheduler stopped/);
assert.deepEqual(sync.manifest.counts,{files:2,members:1300,edges:1300},'a failed sibling initializer cannot retire the published transport');
const during=new AbortController();setImmediate(()=>during.abort());
await assert.rejects(createMapSnapshotTransportAsync(input,{signal:during.signal}),error=>error.name==='AbortError');
const manyDirectories={version:MAP_MODEL_VERSION,nodes:Array.from({length:300},(_,row)=>({path:`directory${row}/one.ts`,members:[]})),edges:[]};
const overview=await createMapSnapshotTransportAsync({model:manyDirectories,snapshotId:'pinned:overview'});
assert.deepEqual(overview.manifest.overview,[{key:'',label:'Available snapshot',files:300,members:0,all:true}]);
const retiring=await createMapSnapshotTransportAsync(input);
await assert.rejects(retiring.respondAsync(summary,{yieldControl:async()=>retiring.dispose()}),error=>error.name==='AbortError');
overview.dispose();cooperative.dispose();cooperative.dispose();sync.dispose();
console.log('Cooperative actual snapshot startup and directed summary preserve shared semantics, cancellation and partial cleanup; runtime evidence deferred.');
