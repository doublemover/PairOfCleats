import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { createSourceIndex } from '../../src/map/isometric/client/source-index.js';
import { initResidencyOwner } from '../../src/map/isometric/client/data/residency-owner.js';

const source={nodes:[{path:'a.ts',members:[{id:'opaque:a',name:'a'}]},{path:'b.ts',members:[{id:'opaque:b',name:'b'}]}],edges:[]};
const requests=[],scene={identity:'last accepted scene'};
Object.assign(state,{sourceIndex:createSourceIndex(source),selectedInfo:null,renderer:{},scene,layoutStyle:'stacks',layout:{groupDepth:1},scaleFactor:1,
  dom:{summary:{textContent:'Accepted source summary'}},performance:{drawCaps:{files:1,members:1,edges:1}},displayLimits:{maxFiles:1,maxMembersPerFile:1},stackModel:{files:[]},graphWorkerReady:true,
  graphWorkerClient:{request(kind,payload,{signal}){return new Promise((resolve,reject)=>{
    const entry={kind,payload,resolve,reject,signal};requests.push(entry);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });}}});
const owner=initResidencyOwner();
const first=owner.reveal({type:'member',id:'opaque:a'});
const second=owner.reveal({type:'member',id:'opaque:b'});
assert.equal(requests[0].signal.aborted,true);
assert.equal((await first).committed,false);
assert.match(state.dom.summary.textContent,/Preparing selected/,'old cancellation cannot restore its status over the newer request');
requests[1].reject(new Error('authored second preparation failure'));
assert.equal((await second).committed,false);assert.match(state.dom.summary.textContent,/authored second preparation failure/);
assert.strictEqual(state.scene,scene,'no failed preparation retires the accepted scene');
owner.dispose();assert.equal(state.revealSourceSelection,null);
console.log('Progressive cancellation and request-owned status preserve newer work and the accepted scene.');
