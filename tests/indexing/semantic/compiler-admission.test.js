import assert from 'node:assert/strict';
import { assertCompilerAdmissionStart, makeCompilerAdmissionReceipt, normalizeCompilerAdmissionPolicy, planCompilerAdmission } from '../../../src/index/semantic/compiler-admission.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
const h='a'.repeat(64), now=10000;
const inventory={compilerVersion:'5.9.3',toolingHash:h,compilerReceipt:{hash:h},closure:{schemaVersion:1,complete:true,files:[{path:'source.ts',hash:h,bytes:100,contextKey:'project'}],totalFiles:1,totalBytes:100,maxFileBytes:100,projectCount:1}};
const schedulerStats={tokens:{mem:{total:2,used:0}},adaptive:{memoryPerTokenMb:1,maxInFlightBytes:8192},queues:{relations:{maxInFlightBytes:8192,maxPendingBytes:8192}}};
const policy={maxResidentBytes:4096,maxBytes:2048};
const options={inventory,schedulerStats,policy,runtimeHash:h,now};
assert.equal(planCompilerAdmission(options).reason,'compiler_analysis_cost_unknown');
assert.equal(planCompilerAdmission({...options,inventory:{...inventory,closure:{...inventory.closure,complete:false}},explicit:true}).reason,'compiler_closure_authority_unavailable');
const explicit=planCompilerAdmission({...options,explicit:true});
assert.equal(explicit.admitted,true);
assert.equal(explicit.request.bytes,4096);
assert.equal(explicit.reservation.basis,'explicit-policy-ceiling');
assertCompilerAdmissionStart(explicit,schedulerStats);
assert.equal(planCompilerAdmission({...options,explicit:true,schedulerStats:{...schedulerStats,adaptive:{...schedulerStats.adaptive,maxInFlightBytes:null},queues:{relations:{maxInFlightBytes:null,maxPendingBytes:null}}}}).admitted,true);
for(const cap of [-1,NaN,Infinity,'1024'])assert.equal(planCompilerAdmission({...options,explicit:true,schedulerStats:{...schedulerStats,adaptive:{...schedulerStats.adaptive,maxInFlightBytes:cap}}}).reason,'scheduler_byte_capacity_invalid');
const receipt=makeCompilerAdmissionReceipt({decision:explicit,runtimeHash:h,elapsedMs:20,peakRssBytes:1024,complete:true,measuredAt:now});
const measured=planCompilerAdmission({...options,receipt});
assert.equal(measured.admitted,true);
assert.equal(measured.request.bytes,1280);
assert.equal(planCompilerAdmission({...options,receipt,inlineBudgetMs:10}).reason,'compiler_measured_time_exceeds_inline_budget');
for(const changed of [{complete:false},{runtimeHash:'b'.repeat(64)},{phaseSetHash:'b'.repeat(64)},{measuredAt:now+1},{measuredAt:0}]){
  const configured=changed.measuredAt===0?{...policy,maxReceiptAgeMs:1}:policy;
  assert.equal(planCompilerAdmission({...options,policy:configured,receipt:{...receipt,...changed}}).reason,'compiler_analysis_cost_unknown');
}
assert.equal(planCompilerAdmission({...options,receipt:{...receipt,peakRssBytes:4096}}).reason,'compiler_resident_reservation_exceeded');
assert.equal(planCompilerAdmission({...options,explicit:true,policy:{...policy,maxBytes:50}}).reason,'compiler_closure_bytes_exceeded');
const projects={...inventory,closure:{...inventory.closure,projectCount:2}};
assert.equal(planCompilerAdmission({...options,inventory:projects,explicit:true,policy:{...policy,maxProjects:1}}).reason,'compiler_closure_projects_exceeded');
const tokenBound={...schedulerStats,adaptive:{...schedulerStats.adaptive,memoryPerTokenMb:1/1024}};
assert.equal(planCompilerAdmission({...options,schedulerStats:tokenBound,explicit:true}).reason,'scheduler_memory_capacity_exceeded');
for(const [name,stats]of [
  ['scheduler_global_bytes_exceeded',{...schedulerStats,adaptive:{...schedulerStats.adaptive,maxInFlightBytes:100}}],
  ['scheduler_relations_bytes_exceeded',{...schedulerStats,queues:{relations:{maxInFlightBytes:100}}}],
  ['scheduler_relations_pending_bytes_exceeded',{...schedulerStats,queues:{relations:{maxPendingBytes:100}}}]
]){
  assert.equal(planCompilerAdmission({...options,schedulerStats:stats,explicit:true}).reason,name);
  assert.throws(()=>assertCompilerAdmissionStart(explicit,stats),error=>error.code==='ERR_SEMANTIC_COMPILER_ADMISSION'&&error.reason===name);
}
assert.throws(()=>assertCompilerAdmissionStart(explicit,tokenBound),/scheduler_memory_token_unit_changed/);
assert.throws(()=>planCompilerAdmission({...options,inventory:{...inventory,closure:{...inventory.closure,totalBytes:101}}}),/totals disagree/);
assert.throws(()=>normalizeCompilerAdmissionPolicy({maxResidentBytes:Number.MAX_SAFE_INTEGER+1}),TypeError);
assert.throws(()=>normalizeCompilerAdmissionPolicy({measurementHeadroom:0.5}),TypeError);
assert.throws(()=>normalizeCompilerAdmissionPolicy({inventedCap:1}),TypeError);
assert.equal(normalizeSemanticConfig({execution:{compilerAdmission:policy}}).execution.compilerAdmission.maxFiles,10000);
assert.throws(()=>normalizeSemanticConfig({execution:{compilerAdmission:{maxBytes:0}}}),/Invalid semantic policy/);
console.log('compiler admission static boundary constructions passed');
