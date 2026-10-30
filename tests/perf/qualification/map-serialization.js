import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
if (!process.argv[2]) throw new Error('Explicit output directory required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: false });
const source = captureSweepSource(process.cwd()), observations = [];
const controlResult = await runQualificationCapsule({ args: ['--expose-gc','tools/bench/map/worker.js',
  JSON.stringify({ operation: 'transient-memory-control' })], receiptPath: path.join(output,'transient-native-invocation.json') });
const transientControl = JSON.parse(controlResult.stdout);
await atomicWriteJson(path.join(output,'transient-native.json'),{historicalAuthorWorkspace:true,source,
  capsuleMs:controlResult.durationMs,report:transientControl},{createOnly:true});
assert.equal(controlResult.stderr,'');assert.equal(controlResult.outputCapture.stdout.truncated,false);
assert.equal(transientControl.state,'qualified-actual-transient',transientControl.unqualifiedReason);
assert.equal(transientControl.touchedBytes,32*1024*1024);assert.equal(transientControl.checksum,3019898880);
assert.equal(transientControl.preparationCollections,2);assert.equal(transientControl.explicitReleaseCollections,2);
assert.equal(transientControl.allocationObserved,true);
assert.equal(transientControl.nativeHighWaterObserved,true);
assert.ok(transientControl.memory.processLifetimeRss.bytes>Math.max(transientControl.before.rss,transientControl.after.rss));
assert.ok(transientControl.during.rss>Math.max(transientControl.before.rss,transientControl.after.rss));
for (let trial = 0; trial < 6; trial++) for (const profile of trial % 2 ? ['large', 'medium'] : ['medium', 'large']) {
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/map-serialization-pair.js', JSON.stringify({ profile, trial })],
    receiptPath: path.join(output, `invocation-${profile}-${trial + 1}.json`) });
  assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
  const report = JSON.parse(result.stdout); observations.push({ profile, trial, capsuleMs: result.durationMs, report });
  await atomicWriteJson(path.join(output, `${profile}-${trial + 1}.json`), { historicalAuthorWorkspace: true, source,
    capsuleMs: result.durationMs, report }, { createOnly: true });
  console.log(JSON.stringify({ profile, trial: trial + 1, capsuleMs: result.durationMs, inputBytes: report.inputIdentity.bytes }));
}
for (const profile of ['medium', 'large']) {
  const rows = observations.filter(row => row.profile === profile); assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map(row => row.report.inputIdentity.hash)).size, 1);
  if (profile === 'large') assert.ok(rows.some(row => ['baseline', 'streaming'].some(arm => {
    const phases = row.report[arm].samples[0].gcObservation.phases; return phases.warmup.count + phases.measured.count > 0;
  })), 'actual writer/warmup GC evidence is required; input-admission GC alone cannot qualify that boundary');
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source,
  claim: 'synthetic serializer observations only;no whole-build or stable performance-gain claim', transientControl, observations }, { createOnly: true });
