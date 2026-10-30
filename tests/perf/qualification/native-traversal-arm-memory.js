import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { projectionWorkloads, assertProjection, digest } from '../../fixtures/benchmarks/native-projection-workloads.js';

await requireBootstrap(); applyTestEnv();
const [destination, language = 'all'] = process.argv.slice(2);
assert.ok(destination); assert.ok(['all', 'scala', 'css', 'lua'].includes(language));
const output = path.resolve(destination); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
const observations = [], comparisons = [], languages = language === 'all' ? ['scala', 'css', 'lua'] : [language];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validateMemory = row => {
  assert.ok(Number.isSafeInteger(row.processLifetimeMaxRssKiB) && row.processLifetimeMaxRssKiB > 0);
  for (const key of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) {
    assert.ok(Number.isSafeInteger(row.memory[key]) && row.memory[key] >= 0, key);
  }
};
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const selected of repetition % 2 ? languages : languages.toReversed()) {
    const specs = (await projectionWorkloads(selected)).filter(spec => ['small', 'wide', 'declarations', 'deep'].includes(spec.name));
    const paired = {};
    for (const arm of repetition % 2 ? ['original', 'current'] : ['current', 'original']) {
      const name = selected + '-' + arm + '-' + repetition, directory = path.join(output, name);
      const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/native-traversal-arm-memory.js', selected, arm, directory],
        receiptPath: path.join(output, name + '-invocation.json') });
      assert.equal(result.exitCode, 0); assert.equal(result.signal, null); assert.equal(result.termination, undefined);
      assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert.ok(result.durationMs < 30000);
      for (const capture of [result.outputCapture.stdout, result.outputCapture.stderr]) {
        assert.equal(capture.truncated, false); assert.equal(capture.encodingLoss, false);
      }
      const receiptPath = path.join(directory, 'receipt.json'), bytes = await fs.readFile(receiptPath), receipt = JSON.parse(bytes);
      assert.equal(receipt.status, 'passed'); assert.equal(receipt.language, selected); assert.equal(receipt.arm, arm);
      assert.deepEqual(receipt.source, source); assert.ok(receipt.elapsedMs < 30000);
      assert.equal(receipt.process.pid, result.pid); assert.equal(receipt.process.node, process.version);
      assert.ok(Number.isFinite(receipt.process.startedAtUnixMs) && receipt.process.startedAtUnixMs > 0);
      assert.equal(receipt.process.platform, process.platform); assert.equal(receipt.process.arch, process.arch);
      assert.equal(receipt.process.abi, process.versions.modules); assert.equal(receipt.owner.interceptions, 1);
      assert.equal(receipt.owner.original.commit, '24230d7960127ab7e4a01f2c040bf3d859f6b46b');
      assert.deepEqual(receipt.operationCounts, arm === 'original' ? { original: 8, current: 0 } : { original: 0, current: 8 });
      assert.equal(receipt.cleanup.qualificationHookReleased, true); assert.equal(receipt.cleanup.parserResetCalls, 8);
      assert.equal(receipt.cleanup.originalTreePasses, 8);
      assert.ok([0, 8].includes(receipt.cleanup.treeCleanupCalls));
      assert.equal(receipt.observations.length, 4); assert.equal(receipt.inputs.length, 4);
      assert.ok(receipt.checkpoints.length > 20 && receipt.checkpoints.length < 100);
      for (const checkpoint of receipt.checkpoints) validateMemory(checkpoint);
      validateMemory(receipt.finalCheckpoint);
      assert.ok(receipt.unsampledResourceUsage.maxRSS > 0);
      assert.ok(receipt.processResourceUsage.maxRSS >= receipt.unsampledResourceUsage.maxRSS);
      for (const [index, shape] of receipt.observations.entries()) {
        const spec = specs[index], input = receipt.inputs[index];
        assert.equal(shape.shape, spec.name); assert.equal(input.shape, spec.name);
        assert.equal(input.source, spec.text); assert.equal(input.sourceSha256, digest(spec.text));
        assert.equal(input.sourceBytes, Buffer.byteLength(spec.text)); assert.equal(input.utf16Units, spec.text.length);
        assert.deepEqual(input.expectedNames, spec.names); assert.deepEqual(input.expectedOccurrences, spec.calls);
        const facts = assertProjection(shape.retainedEvidence, spec);
        assert.equal(shape.work.reason, null); assert.equal(shape.work.frontier, 0);
        assert.ok(shape.work.operations <= receipt.budget.maxAstNodes && shape.work.maxFrontier <= receipt.budget.maxAstStack);
        assert.equal(shape.retainedEvidenceSha256, digest(shape.retainedEvidence));
        assert.equal(shape.occurrenceEvidenceSha256, digest(facts));
        assert.equal(shape.outputBytes, Buffer.byteLength(JSON.stringify(shape.retainedEvidence)));
        assert.ok(shape.parse.wallMs >= 0); assert.ok(shape.parse.cpu.user >= 0 && shape.parse.cpu.system >= 0);
        assert.equal(shape.allocations.iterations, 1);
        const expectedProfile = path.join(directory, selected + '-' + spec.name + '-' + arm + '-allocation.json');
        assert.equal(shape.allocations.path, expectedProfile);
        const profile = await fs.readFile(expectedProfile);
        assert.equal(profile.length, shape.allocations.bytes); assert.equal(sha(profile), shape.allocations.sha256);
        const allocation = JSON.parse(profile);
        assert.equal(allocation.samplingInterval, 32768); assert.equal(allocation.includeCollectedMajorAndMinor, true);
        assert.equal(allocation.samples.length, shape.allocations.sampleCount);
        assert.equal(allocation.samples.reduce((sum, sample) => sum + sample.size, 0), shape.allocations.sampledBytes);
      }
      const previous = observations.find(row => row.language === selected);
      if (previous) {
        assert.deepEqual(receipt.inputs, previous.receipt.inputs); assert.deepEqual(receipt.grammar, previous.receipt.grammar);
        assert.deepEqual(receipt.owner, previous.receipt.owner);
        assert.deepEqual(receipt.observations.map(row => row.retainedEvidence), previous.receipt.observations.map(row => row.retainedEvidence));
      }
      const observation = { repetition, language: selected, arm, capsuleMs: result.durationMs,
        originalProcess: { pid: result.pid, startedAtUnixMs: receipt.process.startedAtUnixMs, exitCode: result.exitCode, signal: result.signal,
          scope: 'Canonical subprocess runner returned on original child close with no termination path. Parser/projection creates no workers;source-witness Git children use the original synchronous runner and settle before its return.' },
        receiptPath, receiptSha256: sha(bytes), receipt };
      paired[arm] = observation; observations.push(observation);
      console.log(JSON.stringify({ name, capsuleMs: result.durationMs,
        unsampledProcessLifetimeMaxRssKiB: receipt.unsampledResourceUsage.maxRSS,
        prePublicationProcessLifetimeMaxRssKiB: receipt.processResourceUsage.maxRSS }));
    }
    assert.notDeepEqual([paired.original.originalProcess.pid, paired.original.originalProcess.startedAtUnixMs],
      [paired.current.originalProcess.pid, paired.current.originalProcess.startedAtUnixMs], 'Fresh process incarnations;PID reuse alone is not identity.');
    assert.deepEqual(paired.original.receipt.observations.map(row => row.retainedEvidence),
      paired.current.receipt.observations.map(row => row.retainedEvidence), 'Fresh arms retain every output field,not just adjacency/counts.');
    comparisons.push({ language: selected, repetition, equivalentCompleteEvidence: true,
      original: { receiptSha256: paired.original.receiptSha256,
        unsampledProcessLifetimeMaxRssKiB: paired.original.receipt.unsampledResourceUsage.maxRSS,
        prePublicationProcessLifetimeMaxRssKiB: paired.original.receipt.processResourceUsage.maxRSS },
      current: { receiptSha256: paired.current.receiptSha256,
        unsampledProcessLifetimeMaxRssKiB: paired.current.receipt.unsampledResourceUsage.maxRSS,
        prePublicationProcessLifetimeMaxRssKiB: paired.current.receipt.processResourceUsage.maxRSS } });
  }
}
assert.equal(observations.length, languages.length * 2 * 3);
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1484, status: 'passed', historicalAuthorWorkspace: true,
  source, language, repetitions: 3, observations, comparisons, memoryReductionClaim: null,
  scope: 'Serial fresh single-arm children;three original/current process pairs per selected language,all four exact comparison shapes and complete output parity. Each original capsule retains30seconds,zero retries and strict empty stderr. Native parse is observed separately;memory passes do not replace16 paired clean timing samples.',
  limits: 'Each OS high-water belongs to one arm child but includes startup/imports/native parse/current semantic callbacks/validation. Unsampled high-water precedes JS sampling;pre-publication high-water also includes Inspector and raw-profile storage. No subtraction of process maxima,phase/native allocator peak,forced-GC freeing or lower-memory/speed claim. Equal/dominated measurements remain valid observations;raw profiles/checkpoints permit assessment without inventing an improvement.' }, { createOnly: true });
