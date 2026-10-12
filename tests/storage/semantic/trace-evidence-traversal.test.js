import {writeSemanticQueryIndex} from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import assert from 'node:assert/strict';
import {createRecoveryFixture,semanticNode} from '../../helpers/semantic-recovery.js';
import {createSemanticTraceService} from '../../../src/semantic/trace.js';
const fixture=await createRecoveryFixture('value');
try {
  const ref=localId=>({partitionId:fixture.partitionId,localId});
  const edges=[{from:ref(0),to:ref(1),evidence:ref(2)},{from:ref(1),to:ref(2),evidence:null},{from:ref(2),to:ref(3),evidence:null}].map((edge,id)=>({family:'edge',row:{id,kind:'flowsTo',callSite:null,operandOrdinal:null,contextKey:null,condition:null,certainty:'modeled',...edge}}));
  const partition=await fixture.write([...Array.from({length:4},(_,id)=>semanticNode(id,5)),...edges]);
  const queryIndex=await writeSemanticQueryIndex({root:fixture.stagingRoot,generation:fixture.generation,partitions:[partition],store:fixture.store([partition]),diskAccount:fixture.account});
  const store=fixture.store([partition],{queryIndex});
  const service=createSemanticTraceService(),request={repoRoot:fixture.root,generation:fixture.generation,seed:ref(0),direction:'downstream',limits:{records:1,edges:2,bytes:16384,depth:5}};
  let cursor=null,seen=false,pages=0;
  do {const result=await service({store,request:{...request,cursor}});seen ||= result.records.some(row=>row.ref.localId===3);cursor=result.cursor;assert.ok(++pages<12);}while(cursor);
  assert.ok(seen,'prior evidence hydration must not suppress later semantic traversal of the same qualified ref');
  console.log('Evidence hydration and traversal remain distinct across trace continuations');
}finally{await fixture.cleanup();}
