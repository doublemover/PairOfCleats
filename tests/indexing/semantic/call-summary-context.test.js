import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import assert from 'node:assert/strict';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { advanceTraceContext } from '../../../src/semantic/trace-context.js';
const ref=localId=>({partitionId:'sy1:'+ 'a'.repeat(64),localId});
const channel=(from,to)=>({kind:'flowsTo',from:ref(from),to:ref(to)});
const declarations=[{declaration:ref(0),parameters:[ref(1)],returns:[ref(2)],span:[0,10],complete:true},
  {declaration:ref(3),parameters:[ref(4)],returns:[ref(5)],span:[11,30],complete:true}];
const call={occurrence:ref(6),targets:[ref(0)],arguments:[ref(7)],result:ref(8),span:[15,20],invocationKind:'call',hasSpread:false};
const documents=[{summaries:declarations,calls:[call],flowEdges:[channel(1,2),channel(4,7),channel(8,5)]}];
const result=buildCallDependencySummaries(documents);
assert.equal(result.converged,true);
assert.deepEqual([...result.functions.get(canonicalSemanticJson(ref(3))).dependencies],[0]);
const spread=buildCallDependencySummaries([{...documents[0],calls:[{...call,hasSpread:true}]}]);
assert.equal(spread.functions.get(canonicalSemanticJson(ref(3))).dependencies.size,0,'spread arity cannot fabricate positional input flow');
assert.equal(buildCallDependencySummaries(documents,{maxIterations:0}).converged,false);
const incomplete=buildCallDependencySummaries([{...documents[0],calls:[{...call,incompleteTargets:true}]}]);
assert.equal(incomplete.functions.get(canonicalSemanticJson(ref(3))).dependencies.size,0,'unmapped callable alternatives cannot reuse a falsely unique callee summary');
// Call-owned field and exception summaries propagate through recursive contexts without new trace stack channels.
const effectDeclarations=[
  {declaration:ref(20),parameters:[ref(21),ref(22)],returns:[],effects:[{parameter:0,path:['value'],ref:ref(23)}],exceptions:[ref(24)],span:[40,50],complete:false},
  {declaration:ref(30),parameters:[ref(31),ref(32)],returns:[ref(33)],effects:[],exceptions:[],span:[51,80],complete:false}
];
const effectCall={occurrence:ref(34),targets:[ref(20)],arguments:[ref(35),ref(36)],result:ref(37),span:[60,65],invocationKind:'call',hasSpread:false};
const effectDocuments=[{summaries:effectDeclarations,calls:[effectCall],
  aliases:[{ref:ref(35),root:ref(31),path:[]}],
  callEffects:[{result:ref(37),reads:[{root:ref(31),path:['value'],ref:ref(38)}],exceptionTargets:[ref(39)],exceptionEscapes:false}],
  flowEdges:[channel(22,23),channel(22,24),channel(32,36),channel(38,33)]}];
const effects=buildCallDependencySummaries(effectDocuments),effectOwner=effects.functions.get(canonicalSemanticJson(ref(30)));
assert.deepEqual([...effectOwner.dependencies],[1],'callee field effect reaches following caller field read');
assert.deepEqual([...effectOwner.effectDependencies.values()].map(value=>({parameter:value.parameter,path:value.path,dependencies:[...value.dependencies]})),
  [{parameter:0,path:['value'],dependencies:[1]}],'effect summary stays source-parameter-owned');
assert.equal(effectOwner.exceptionDependencies.size,0,'a caught call does not acquire an escaping exception channel');
const recursive=buildCallDependencySummaries([{...effectDocuments[0],calls:[effectCall,
  {occurrence:ref(40),targets:[ref(30)],arguments:[ref(35),ref(36)],result:ref(41),span:[66,70],invocationKind:'call',hasSpread:false}]}]);
assert.equal(recursive.converged,true,'bounded recursive may summaries reach a monotone fixed point');
const enter={kind:'argumentToParameter',callSite:ref(6),contextKey:'project-a'};
const stack=advanceTraceContext([],enter,'downstream').stack;
assert.equal(advanceTraceContext(stack,{...enter,kind:'returnToResult',callSite:ref(9)},'downstream').skip,true);
assert.equal(advanceTraceContext(stack,{...enter,kind:'returnToResult',contextKey:'project-b'},'downstream').skip,true);
assert.deepEqual(advanceTraceContext(stack,{...enter,kind:'returnToResult'},'downstream').stack,[]);
assert.equal(advanceTraceContext(stack,enter,'downstream',1).frontier,'call_context_budget');
const aborted=new AbortController();aborted.abort();assert.throws(()=>buildCallDependencySummaries(documents,{signal:aborted.signal}),/abort/i);
console.log('Call dependency summaries and balanced invocation contexts passed');
