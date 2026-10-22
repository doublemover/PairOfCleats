import assert from 'node:assert/strict';
import { resolveDecisionFromReasonCode,IMPORT_REASON_CODES } from '../../../src/index/build/import-resolution/reason-codes.js';
import { collectStage1StalledFiles,buildStage1ProcessingStallSnapshot } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';
import { applyTreeSitterBatching } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';
import { shouldElideModalityProcessingStage } from '../../../src/index/build/indexer/pipeline/modality-sparsity.js';
import { mergeTreeSitterSchedulerAdaptiveProfile } from '../../../src/index/build/tree-sitter-scheduler/adaptive-profile.js';
import { appendPhraseNgramsToPostingsMap } from '../../../src/index/build/state/postings-helpers.js';
import { setScmRuntimeConfig,getScmRuntimeConfig,buildScmFreshnessGuard } from '../../../src/index/scm/runtime.js';
import { resolveCheckpointCpuEvidence } from '../../../src/index/build/indexer/pipeline/checkpoints.js';
assert.equal(resolveCheckpointCpuEvidence({platform:'win32',loadAvg:[0,0,0],cpuCount:4,processBusyPct:25}).busyPct,25);
assert.equal(resolveCheckpointCpuEvidence({platform:'linux',loadAvg:[2,0,0],cpuCount:4,processBusyPct:25}).busyPct,50);
for(const key of ['constructor','__proto__','toString'])assert.equal(resolveDecisionFromReasonCode(key).reasonCode,IMPORT_REASON_CODES.UNKNOWN);
const files=new Map([['later',{startedAt:100,orderIndex:9}],['earlier',{startedAt:100,orderIndex:1}]]);
assert.equal(collectStage1StalledFiles(files,{limit:1,nowMs:200})[0].orderIndex,1);
assert.equal(buildStage1ProcessingStallSnapshot({nowMs:200,lastProgressAt:100}).idleMs,100);
assert.equal(buildStage1ProcessingStallSnapshot({nowMs:200,lastProgressAt:100,idleMs:0}).idleMs,0);
assert.equal(shouldElideModalityProcessingStage({fileCount:null,chunkCount:null}),false);
assert.equal(shouldElideModalityProcessingStage({fileCount:0,chunkCount:0}),true);
const entries=[{rel:'src/a.js',ext:'.js'}];applyTreeSitterBatching(entries,{enabled:true},{},{allowReorder:true});
assert.ok(Array.isArray(entries[0].treeSitterAllowedLanguages));
for(const bucketCount of [undefined,null,'bad',0,-1,true,1.5]){
  const merged=mergeTreeSitterSchedulerAdaptiveProfile(new Map([['javascript',{rowsPerSec:10,laneState:{bucketCount,cooldownSteps:2}}]]),[{baseGrammarKey:'javascript',rows:10,durationMs:1000}]);
  assert.equal(merged.get('javascript').laneState,null);
}
for(const gap of [null,'']){
  const map=new Map();appendPhraseNgramsToPostingsMap(map,['a',gap,'b'],7,2,3);assert.equal(map.size,0);
}
const original=getScmRuntimeConfig();
try{
  const input={snapshotSalt:'one',git:{enabled:true}};setScmRuntimeConfig(input);
  const guard=()=>buildScmFreshnessGuard({provider:'git',repoRoot:process.cwd(),repoHeadId:'head'}).key;
  const before=guard();input.git.enabled=false;
  assert.equal(getScmRuntimeConfig().git.enabled,true);
  assert.throws(()=>{getScmRuntimeConfig().snapshotSalt='two';},TypeError);
  assert.equal(guard(),before);
}finally{setScmRuntimeConfig(original);}
console.log('default policy, stable diagnostics and phrase gap contracts passed');
