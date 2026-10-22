import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { createRemoteSource } from '../../src/map/isometric/client/data/remote-source.js';
import { createDemandSnapshotSource } from '../../src/map/isometric/client/data/demand-source.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';

const model={version:MAP_MODEL_VERSION,root:{id:'fixture'},nodes:Array.from({length:1200},(_,i)=>({path:`files/${i}.ts`,members:[{id:i===0?0:`member:${i}:😀`,name:`name${i}`}]})),edges:[]};
const transport=createMapSnapshotTransport({model,snapshotId:'source:eviction'});
const wire=[];const demand=createDemandSnapshotSource({snapshot:'source:eviction',fetchPage:async(request,signal)=>{signal?.throwIfAborted();wire.push(request);return JSON.parse(transport.respond(request));}});
await demand.init();
Object.assign(state,{graphWorkerReady:true,graphWorkerClient:{request:(kind,payload,options={})=>demand.query(kind,payload,options.signal,options.revision)},dom:{summary:{textContent:''}},viewRevisions:null,cancelCameraMotion:null});
const remote=createRemoteSource({manifest:transport.manifest,snapshot:'source:eviction',endpoint:'/unused',token:'fixture'});state.remoteSource=remote;
const history=[];
for(const i of [0,500,1199]){
  await remote.navigate({type:'member',address:{fileRow:i,memberOrdinal:0}},info=>history.push({...info}));
  assert.equal(remote.index.files.size,1,'nonresident selection metadata cannot accumulate across navigation');
  assert.equal(remote.index.members.size,1);assert.equal(remote.index.counts.files,1200);
}
assert.equal(remote.index.resolve(history[0]),null,'old record is evicted, while history keeps only identity/address');
let reopened;await remote.navigate(history[0],info=>{reopened=info;});
assert.equal(reopened.id,0);assert.equal(reopened.name,'name0');assert.equal(reopened.file,'files/0.ts');
const query=await remote.request('search',{query:'name1199',limit:80});assert.equal(query.rows[0].id,'member:1199:😀');
assert.equal(wire.some(request=>request.kind==='edges'),false);
remote.dispose();demand.dispose();transport.dispose();state.remoteSource=null;
console.log('Remote source selection eviction preserves full search and canonical history re-entry beyond initial prefixes.');
