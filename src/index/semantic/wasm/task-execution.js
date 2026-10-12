import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../../semantic/artifact-store.js';
import { createSemanticFactsRef } from '../file-ref.js';
import { schedulerAdmissionReason } from '../compiler-admission.js';
import { collectStandaloneWasm } from './standalone.js';
import { verifyWasmTaskAuthority } from './task-authority.js';
/** The bounded decoder receives scheduler capacity, never a TypeScript Program grant. */
export const prepareWasmTaskExecution = async ({state,runtime,selected}) => {
  const snapshot=runtime.scheduler.stats(), bytes=64*1024*1024;
  const unit=(snapshot.adaptive?.memoryPerTokenMb??runtime.schedulerConfig?.adaptiveMemoryPerTokenMb??runtime.schedulerConfig?.memoryPerTokenMb)*1024*1024;
  const request={cpu:1,io:1,mem:Math.max(1,Math.ceil(bytes/unit)),bytes};
  const reason=selected.length!==1?'wasm_single_module_batch_required':!Number.isSafeInteger(unit)||unit<1?'scheduler_memory_token_unit_unavailable':schedulerAdmissionReason(request,snapshot);
  const decision={admitted:!reason,reason,request};
  return {decision,enter() {const reason=schedulerAdmissionReason(request,runtime.scheduler.stats());if(reason)throw Object.assign(new Error(reason),{code:'ERR_SEMANTIC_COMPILER_ADMISSION',reason});},async verify(signal) {
    for(const item of selected) {
      const store=createArtifactSemanticStore({root:item.root,repoRoot:runtime.root,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,generation:item.generation,partitions:item.syntaxPartitions});
      await verifyWasmTaskAuthority({task:item.task,target:item.targetSet,sources:new Map([...item.sources.values()].map(source=>[source.sourceUnitId,source])),store,signal});
    }
  }};
};
export const executeWasmTask = async ({state,runtime,item,signal}) => {
  const partitions=[];
  for(const [file,source] of item.sources) {
    const current=state.semanticFactsByFile.get(file);
    if(!item.task.sourceUnits.includes(source.sourceUnitId))continue;
    const bytes=await fs.readFile(path.join(item.root,'semantic-sources',source.byteHash+'.utf8'));
    const result=await collectStandaloneWasm({bytes,relPath:source.path,repositoryNamespace:source.repositoryNamespace,stagingRoot:item.root,storage:current.storage,diskAccount:state.semanticDiskAccount,policy:runtime.semanticPolicy,flowGranted:true,signal});
    const facts=result.semanticFactsRef;
    if(facts.syntaxPartitionId!==current.syntaxPartitionId||facts.sourceHash!==current.sourceHash)throw new Error('Binary task changed its pinned syntax authority.');
    const additions=facts.partitions.filter(row=>row.partitionId!==facts.syntaxPartitionId);
    state.semanticFactsByFile.set(file,createSemanticFactsRef({source,storage:current.storage,syntaxPartitionId:current.syntaxPartitionId,
      partitions:[...current.partitions.filter(row=>!additions.some(next=>next.partitionId===row.partitionId)),...additions],coverage:[...current.coverage.filter(row=>row.phase!=='localFlow'),...facts.coverage.filter(row=>row.phase==='localFlow')]}));
    state.semanticEvidenceArtifacts ||= [];state.semanticEvidenceArtifacts.push(...result.semanticEvidenceArtifacts);partitions.push(...additions);
  }
  return {schemaVersion:1,contexts:[],partitions,coverageRef:null,diagnosticsRef:null};
};
