import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { createVfsColdStartSeries } from '../../../tools/bench/vfs/cold-start-cache.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { recordQualificationFailure } from '../../../tools/bench/qualification-capsule.js';

// Explicit campaign, outside test discovery. Each original scenario is one
// <=30s subprocess capsule; the nine-step campaign has no aggregate latency PASS.
await requireBootstrap(); applyTestEnv();
const output = process.argv[2];
if (!output) throw new Error('Required explicit receipt directory argument.');
const destination = path.resolve(output); await fs.mkdir(destination, { recursive: false });
const source = captureSweepSource(process.cwd()), series = await createVfsColdStartSeries({ docs: 256, docBytes: 8191, content: 'utf8', samples: 3 });
const expected = ['cold', 'warm', 'hot', 'cold', 'hot', 'warm', 'cold', 'warm', 'hot'];
const pids = new Set(), started = performance.now();
try {
  for (const [index, mode] of expected.entries()) {
    const capsuleAt = performance.now(), { step, observation } = await series.runNext();
    const capsuleMs = performance.now() - capsuleAt;
    assert.equal(step.mode, mode); assert.equal(step.sample, Math.floor(index / 3) + 1);
    assert.ok(capsuleMs < 30000, 'capsule including parent admission must remain within30s');
    assert.equal(observation.state, 'qualified-phase'); assert.equal(observation.counts.documents, 256);
    assert.equal(observation.consumerParity.bytes, 256 * 8191); assert.equal(observation.consumerParity.state, 'byte-identical');
    assert.equal(observation.workload.generator, 'fixed-byte-utf8-documents-v3');
    assert.ok(!pids.has(observation.pid)); pids.add(observation.pid);
    if (mode === 'cold') {
      assert.equal(observation.counts.created, 256); assert.equal(observation.initialCache.loadedEntries, 0);
    } else if (mode === 'warm') {
      assert.equal(observation.initialCache.loadedEntries, 256); assert.equal(observation.counts.persistedHits, 256);
    } else {
      assert.equal(observation.warmup.existingVerified, 256); assert.equal(observation.warmup.created, 0);
      assert.equal(observation.counts.memoryHits, 256); assert.equal(observation.phases.cacheLoadMs, 0); assert.equal(observation.phases.flushMs, 0);
    }
    if (mode !== 'hot') assert.equal(observation.finalCache.flushes - observation.initialCache.flushes, 1);
    await atomicWriteJson(path.join(destination, `capsule-${index + 1}.json`), { historicalAuthorWorkspace: true, source,
      capsuleMs, step, observation, progress: series.snapshot() }, { createOnly: true });
    console.log(JSON.stringify({ capsule: index + 1, mode, sample: step.sample, capsuleMs }));
  }
  const report = await series.complete();
  assert.equal(pids.size, 9); assert.equal(report.fixtureCleanup, 'completed');
  for (const mode of ['cold', 'warm', 'hot']) assert.equal(report[mode].completedDocuments, 768);
  assert.deepEqual(captureSweepSource(process.cwd()), source);
  await atomicWriteJson(path.join(destination, 'final.json'), { historicalAuthorWorkspace: true, source,
    scope: 'nine original bounded scenario capsules;not-monolithic-command-latency-acceptance',
    campaignWallMs: performance.now() - started, originalAggregateFailureRetained: true,
    observationSha256: createHash('sha256').update(JSON.stringify(report)).digest('hex'), report }, { createOnly: true });
} catch (error) {
  try { await recordQualificationFailure({ error, receiptPath: path.join(destination, 'failure.json'), invocation: series.snapshot() }); }
  catch (publicationError) { await series.abort(publicationError); }
  await series.abort(error);
}
