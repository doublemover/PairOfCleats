import assert from 'node:assert/strict';
import { createFeatureMetrics } from '../../../src/index/build/feature-metrics.js';
import { createPerfProfile,recordFileMetric,finalizePerfProfile } from '../../../src/index/build/perf-profile.js';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';
import { createRuntimeTelemetry } from '../../../src/index/build/runtime/queues.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { getHeadline } from '../../../src/index/headline.js';
import { toEventCounts } from '../../../src/index/diffs/events.js';
import { bumpStat } from '../../../tools/ingest/shared.js';
import { buildScanProfile } from '../../../tools/index/report-artifacts/scan-profile.js';
import { buildTokenAndFieldPostings } from '../../../src/index/build/postings/token-field.js';
import { createFileTimingTracker } from '../../../src/index/build/file-processor/timings.js';
for (const key of ['__proto__','constructor','toString']) {
  const features = createFeatureMetrics();
  features.recordFile({ mode: 'code',languageSet:key,languageLines:new Map([[key,3]]),lines:3,bytes:10,durationMs:5 });
  const finalized = features.finalize();
  assert.equal(finalized.modes.code.languages[key].lines,3);
  assert.ok(Object.hasOwn(finalized.modes.code.languageSets,key));
  const perf = createPerfProfile(); recordFileMetric(perf,{ languageId:key,bytes:10,lines:1,durationMs:2 });
  assert.equal(finalizePerfProfile(perf).languages[key].totals.files,1);
  const recorder = createStageCheckpointRecorder(); recorder.record({ stage:key,memory:{ rss:1 } });
  assert.equal(recorder.buildSummary().stages[key].checkpointCount,1);
  const telemetry = createRuntimeTelemetry(); telemetry.setInFlightBytes(key,{ bytes:17,count:1 }); telemetry.recordDuration(key,25);
  assert.ok(Object.hasOwn(telemetry.readInFlightBytes().channels,key));
  assert.equal(telemetry.readDurationHistograms()[key].count,1);
  const bucket = {}; bumpStat(bucket,key); bumpStat(bucket,key); assert.equal(bucket[key],2);
  assert.equal(toEventCounts([{kind:key}])[key],1);
  const paramTypes = JSON.parse(`{"${key}":"string"}`);
  const meta = buildMetaV2({ chunk:{ file:'a.js',start:0,end:5,kind:'FunctionDeclaration' },docmeta:{ paramTypes } });
  assert.equal(meta.types.declared.params[key][0].type,'string');
}
assert.equal(getHeadline({},['constructor','beta','beta'],1),'beta');
assert.equal(getHeadline({},['__proto__']),'__proto__');
const scan = buildScanProfile({ indexMetrics:{code:{files:{skippedByReason:JSON.parse('{"__proto__":2}')}}},
  featureMetrics:{modes:{code:{languages:JSON.parse('{"__proto__":{"lines":3}}')}}} });
assert.equal(scan.languageLines.__proto__,3);
const fields=Object.create(null),lengths=Object.create(null);
fields.__proto__=new Map([['token',[[0,1]]]]);lengths.__proto__=[1];
const postings=await buildTokenAndFieldPostings({sparseEnabled:true,tokenPostings:new Map(),fieldPostings:fields,
  fieldDocLengths:lengths,normalizedDocLengths:[1],normalizeTfPostingList:value=>value});
assert.ok(Object.hasOwn(postings.fieldPostingsResult.fields,'__proto__'));
const durations=[];
const tracker=createFileTimingTracker({mode:'code',featureMetrics:{recordSetting:value=>durations.push(value)}});
tracker.addLineSpan('js',1,10);tracker.addLineSpan('html',1,10);tracker.setGitDuration(10);
const lines=tracker.finalizeLanguageLines({fileLineCount:10,fileLanguageId:'js'});
tracker.recordFeatureMetrics({gitBlameEnabled:true,fileLineCount:10,...lines});
assert.equal(durations.reduce((sum,value)=>sum+value.durationMs,0),10);
console.log('arbitrary metric and metadata keys passed');
