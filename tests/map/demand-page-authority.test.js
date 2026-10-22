import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { createDemandSnapshotSource } from '../../src/map/isometric/client/data/demand-source.js';
import { validateSnapshotPage, validateSnapshotManifest } from '../../src/map/isometric/client/data/page-authority.js';

const model={version:MAP_MODEL_VERSION,nodes:[{path:'src/a.ts',members:[{id:0,name:'zero'},{id:'opaque:1:😀',name:'one'}]}],edges:[]};
const transport=createMapSnapshotTransport({model,snapshotId:'pinned:authority'});let corrupt=true,calls=0;
const source=createDemandSnapshotSource({snapshot:'pinned:authority',fetchPage:async request=>{
  calls++;const page=JSON.parse(transport.respond(request));if(corrupt&&request.kind==='members')page.next=request.cursor;return page;
}});
await source.init();await assert.rejects(source.query('members',{fileRow:0,limit:1}),/continuation/);
corrupt=false;const page=await source.query('members',{fileRow:0,limit:1});assert.equal(page.rows[0].id,0);
assert.equal(Object.isFrozen(page.rows[0]),true);assert.throws(()=>{page.rows[0].id='changed by renderer';},TypeError);
const count=calls;assert.strictEqual(await source.query('members',{fileRow:0,limit:1}),page);assert.equal(calls,count,'only validated immutable evidence is cached');
const request={kind:'members',fileRow:0,cursor:0,limit:1};
assert.throws(()=>validateSnapshotPage({...page,rows:[{...page.rows[0],address:{fileRow:1,memberOrdinal:0}}]},request,transport.manifest),/owner\/address/);
assert.throws(()=>validateSnapshotManifest({...transport.manifest,overview:[{key:'fake',files:99,members:2}]},'pinned:authority'),/source totals/);
const resolved=await source.query('resolve',{entity:{type:'member',id:'0'}});assert.equal(resolved.entity.id,0,'legacy alias resolves to original numeric identity without parsing it');
source.dispose();transport.dispose();console.log('Demand pages validate pinned continuation/source addresses and reject consumer mutation before cache admission; execution deferred.');
