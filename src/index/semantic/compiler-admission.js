import { semanticHash } from './identity.js';

export const DEFAULT_COMPILER_ADMISSION_POLICY = Object.freeze({maxFiles:10000,maxBytes:134217728,maxProjects:32,
  maxResidentBytes:536870912,measurementHeadroom:1.25,maxReceiptAgeMs:604800000});
const hash = value => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer = (value,name,min=0) => {if(!Number.isSafeInteger(value)||value<min)throw new TypeError('Invalid compiler admission '+name);return value;};
const add = (a,b) => integer(a+b,'byte sum');
const phaseIdentity = phases => {
  if(!Array.isArray(phases)||!phases.length||phases.some(phase=>!['bind','localFlow','crossFileFlow'].includes(phase)))throw new TypeError('Invalid compiler admission phases.');
  return semanticHash('semantic.compiler.admission-phases.v1',[...new Set(phases)].sort());
};
export const normalizeCompilerAdmissionPolicy = input => {
  if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_COMPILER_ADMISSION_POLICY,key))))throw new TypeError('Invalid compiler admission policy.');
  const policy={...DEFAULT_COMPILER_ADMISSION_POLICY,...input};
  for(const key of ['maxFiles','maxBytes','maxProjects','maxResidentBytes','maxReceiptAgeMs'])integer(policy[key],key,1);
  if(!Number.isFinite(policy.measurementHeadroom)||policy.measurementHeadroom<1||policy.measurementHeadroom>4)throw new TypeError('Invalid compiler measurement headroom.');
  return policy;
};
const closureIdentity = inventory => {
  const closure=inventory?.closure;
  if(!closure||closure.schemaVersion!==1||closure.complete!==true||!Array.isArray(closure.files))return null;
  const seen=new Set();let bytes=0,maxFileBytes=0;
  for(const row of closure.files){
    if(!row||typeof row.path!=='string'||!row.path||!hash(row.hash)||typeof row.contextKey!=='string'||!row.contextKey)throw new TypeError('Invalid compiler closure row.');
    integer(row.bytes,'closure file bytes');
    const key=JSON.stringify([row.contextKey,row.path]);if(seen.has(key))throw new TypeError('Duplicate context-qualified compiler closure file.');seen.add(key);
    bytes=add(bytes,row.bytes);maxFileBytes=Math.max(maxFileBytes,row.bytes);
  }
  integer(closure.totalFiles,'closure files');integer(closure.totalBytes,'closure bytes');integer(closure.maxFileBytes,'maximum file bytes');integer(closure.projectCount,'project count');
  if(closure.totalFiles!==closure.files.length||closure.totalBytes!==bytes||closure.maxFileBytes!==maxFileBytes
    ||closure.projectCount<new Set(closure.files.map(row=>row.contextKey)).size)throw new TypeError('Compiler closure totals disagree.');
  if(!hash(inventory.toolingHash)||!hash(inventory.compilerReceipt?.hash)||typeof inventory.compilerVersion!=='string')return null;
  const inputHash=semanticHash('semantic.compiler.admission-input.v1',{compilerVersion:inventory.compilerVersion,
    compilerReceipt:inventory.compilerReceipt,toolingHash:inventory.toolingHash,closure:{...closure,files:[...closure.files].sort((a,b)=>a.contextKey.localeCompare(b.contextKey)||a.path.localeCompare(b.path))}});
  return {inputHash,files:closure.totalFiles,bytes,projects:closure.projectCount,maxFileBytes};
};
const capacityReason = (request,snapshot) => {
  const total=snapshot?.tokens?.mem?.total;
  if(!Number.isSafeInteger(total)||total<1)return 'scheduler_memory_capacity_unavailable';
  if(request.mem>total)return 'scheduler_memory_capacity_exceeded';
  for(const [reason,cap] of [['scheduler_global_bytes_exceeded',snapshot.adaptive?.maxInFlightBytes],
    ['scheduler_relations_bytes_exceeded',snapshot.queues?.relations?.maxInFlightBytes],
    ['scheduler_relations_pending_bytes_exceeded',snapshot.queues?.relations?.maxPendingBytes]]){
    if(cap!=null&&(!Number.isSafeInteger(cap)||cap<0))return 'scheduler_byte_capacity_invalid';
    if(cap>0&&request.bytes>cap)return reason;
  }
  return null;
};

/** Policy admission, not a heap limit or forecast guarantee. Unknown auto cost remains deferred. */
export const planCompilerAdmission = ({inventory,policy:input,schedulerStats,schedulerConfig={},runtimeHash,
  phases=['bind'],receipt=null,explicit=false,inlineBudgetMs=100,now=Date.now()}) => {
  const policy=normalizeCompilerAdmissionPolicy(input),closure=closureIdentity(inventory),phaseSetHash=phaseIdentity(phases);
  integer(now,'receipt clock');integer(inlineBudgetMs,'inline time budget');
  const decision={schemaVersion:1,admitted:false,reason:null,inputHash:closure?.inputHash||null,phaseSetHash,
    policyHash:semanticHash('semantic.compiler.admission-policy.v1',policy),closure,
    measurement:{usable:false,elapsedMs:null,peakRssBytes:null,basis:'unavailable'},reservation:null,request:null,
    limitations:['Scheduler reservation is policy admission, not a hard process-memory limit or guaranteed future cost.']};
  const reject=reason=>({...decision,reason});
  if(!closure)return reject('compiler_closure_authority_unavailable');
  if(closure.files>policy.maxFiles)return reject('compiler_closure_files_exceeded');
  if(closure.bytes>policy.maxBytes)return reject('compiler_closure_bytes_exceeded');
  if(closure.projects>policy.maxProjects)return reject('compiler_closure_projects_exceeded');
  const usable=receipt?.schemaVersion===1&&receipt.complete===true&&receipt.inputHash===closure.inputHash
    &&receipt.phaseSetHash===phaseSetHash&&hash(runtimeHash)&&receipt.runtimeHash===runtimeHash
    &&Number.isFinite(receipt.elapsedMs)&&receipt.elapsedMs>=0&&Number.isSafeInteger(receipt.peakRssBytes)&&receipt.peakRssBytes>0
    &&receipt.rssBasis==='process-high-water'&&Number.isSafeInteger(receipt.measuredAt)&&receipt.measuredAt<=now
    &&now-receipt.measuredAt<=policy.maxReceiptAgeMs;
  if(usable)decision.measurement={usable:true,elapsedMs:receipt.elapsedMs,peakRssBytes:receipt.peakRssBytes,basis:'matching-complete-receipt'};
  if(!explicit&&!usable)return reject('compiler_analysis_cost_unknown');
  if(!explicit&&receipt.elapsedMs>inlineBudgetMs)return reject('compiler_measured_time_exceeds_inline_budget');
  const reservedBytes=usable?Math.max(closure.bytes,Math.ceil(receipt.peakRssBytes*policy.measurementHeadroom)):policy.maxResidentBytes;
  if(!Number.isSafeInteger(reservedBytes)||reservedBytes>policy.maxResidentBytes)return reject('compiler_resident_reservation_exceeded');
  if(closure.bytes>reservedBytes)return reject('compiler_input_exceeds_reservation');
  const perTokenMb=schedulerStats?.adaptive?.memoryPerTokenMb??schedulerConfig.adaptiveMemoryPerTokenMb??schedulerConfig.memoryPerTokenMb;
  const perTokenBytes=perTokenMb*1024*1024;
  if(!Number.isSafeInteger(perTokenBytes)||perTokenBytes<1)return reject('scheduler_memory_token_unit_unavailable');
  const mem=Math.max(1,Math.ceil(reservedBytes/perTokenBytes));
  decision.reservation={bytes:reservedBytes,mem,basis:usable?'observed-process-high-water-with-policy-headroom':'explicit-policy-ceiling',memoryTokenBytes:perTokenBytes};
  decision.request={cpu:1,io:1,mem,bytes:reservedBytes};
  const reason=capacityReason(decision.request,schedulerStats);if(reason)return reject(reason);
  decision.admitted=true;decision.reason=usable?'matching_measured_receipt':'explicit_bounded_policy';return decision;
};

/** Recheck immediately inside the leased scheduler callback: oversize-idle bypass must not admit a Program. */
export const assertCompilerAdmissionStart = (decision,schedulerStats,schedulerConfig={}) => {
  const tokenMb=schedulerStats?.adaptive?.memoryPerTokenMb??schedulerConfig.adaptiveMemoryPerTokenMb??schedulerConfig.memoryPerTokenMb;
  const tokenBytes=tokenMb*1024*1024;
  const reason=decision?.admitted&&tokenBytes!==decision.reservation?.memoryTokenBytes?
    'scheduler_memory_token_unit_changed':!decision?.admitted||!decision.request?'compiler_not_admitted':capacityReason(decision.request,schedulerStats);
  if(reason)throw Object.assign(new Error('Compiler Program admission blocked: '+reason),{code:'ERR_SEMANTIC_COMPILER_ADMISSION',reason});
};
export const makeCompilerAdmissionReceipt = ({decision,runtimeHash,elapsedMs,peakRssBytes,complete,measuredAt=Date.now()}) => {
  if(!decision?.inputHash||!hash(runtimeHash)||!Number.isFinite(elapsedMs)||elapsedMs<0||typeof complete!=='boolean')throw new TypeError('Invalid compiler measurement receipt.');
  integer(peakRssBytes,'observed process high water',1);integer(measuredAt,'measurement clock');
  return {schemaVersion:1,inputHash:decision.inputHash,phaseSetHash:decision.phaseSetHash,runtimeHash,
    complete,elapsedMs,peakRssBytes,rssBasis:'process-high-water',measuredAt};
};
