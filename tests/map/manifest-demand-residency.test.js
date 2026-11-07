/** Authored demand/overview contracts, no browser/worker host or measured-memory claim. */
import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { createSnapshotWorkerOwner } from '../../src/map/isometric/client/data/worker-owner.js';
import { createSnapshotPageCache } from '../../src/map/isometric/client/data/page-cache.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

const model={version:MAP_MODEL_VERSION,root:{id:'recorded'},nodes:Array.from({length:2000},(_,i)=>({path:`dir${i%2}/${i}.ts`,members:Array.from({length:i===1999?10001:1},(_,j)=>({id:`opaque:${i}:日本語:${j}`,name:`symbol${i}_${j}`,kind:'function'}))})),
  edges:[{type:'call',from:{member:'opaque:1999:日本語:10000'},to:{member:'opaque:0:日本語:0'},certainty:'exact original evidence',metadata:{preserved:true}}],summary:{dropped:{files:2,members:4,edges:1},truncated:true}};
const transport=createMapSnapshotTransport({model,snapshotId:'pinned:demand'}),calls=[],messages=[];
assert.equal(transport.manifest.overview.reduce((sum,row)=>sum+row.files,0),2000);
assert.equal(transport.manifest.overview.reduce((sum,row)=>sum+row.members,0),12000);
const owner=createSnapshotWorkerOwner({post:message=>messages.push(message),fetchPage:async(request,signal)=>{signal.throwIfAborted();calls.push(request);return JSON.parse(transport.respond(request));}});
await owner.handle({protocol:MAP_DATA_PROTOCOL,snapshot:'pinned:demand',request:1,revision:0,kind:'init',demand:true});
assert.deepEqual(calls.map(call=>call.kind),['manifest'],'first ready overview does not await file/member/edge pages');
assert.equal(messages.find(message=>message.event==='ready').stats.mode,'demand');
await owner.handle({protocol:MAP_DATA_PROTOCOL,snapshot:'pinned:demand',request:2,revision:1,kind:'search',payload:{query:'symbol1999_10000'}});
const selected=messages.find(message=>message.request===2).value.rows[0];assert.equal(selected.id,'opaque:1999:日本語:10000');assert.equal(selected.address.memberOrdinal,10000);
await owner.handle({protocol:MAP_DATA_PROTOCOL,snapshot:'pinned:demand',request:3,revision:2,kind:'layout',payload:{selection:selected,budgets:{files:2,members:40,membersPerFile:20,edges:10},layout:{scale:1,groupDepth:1}}});
const result=messages.find(message=>message.request===3).value;assert.ok(result.model.memberById.has(selected.id));
assert.equal(result.plan.coverage.available.files,2000);assert.equal(result.plan.coverage.available.members,12000);assert.ok(result.plan.coverage.resident.members<=40);
assert.equal(result.plan.coverage.queryExpanded,false);assert.deepEqual(result.model.levels.segments[0].evidence,model.edges[0]);
assert.equal(calls.some(call=>call.kind==='edges'),false,'resident reveal does not fetch the full edge table');
assert.ok(calls.filter(call=>call.kind==='members').every(call=>call.limit<=20));assert.ok(result.cache.retainedPayloadBytes<=4*1024*1024);
const cache=createSnapshotPageCache({maxBytes:1000,maxPages:2});cache.set('a',{source:'a'});cache.set('b',{source:'b'});cache.get('a');cache.set('c',{source:'c'});
assert.equal(cache.get('b'),null);assert.deepEqual(cache.get('a'),{source:'a'});assert.equal(cache.stats().evictions,1);
cache.dispose();owner.dispose();transport.dispose();
console.log('Manifest-first demand readiness, far-field bounded reveal, exact evidence and reversible page eviction authored.');
