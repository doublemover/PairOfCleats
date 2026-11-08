import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTraversalComparisonOwner } from './native-traversal-comparison-owner.js';
import { projectionWorkloads, assertProjection, evidence, digest } from './native-projection-workloads.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';

await requireBootstrap(); applyTestEnv();
const [language, arm, destination] = process.argv.slice(2);
assert.ok(['scala', 'css', 'lua'].includes(language));
assert.ok(['original', 'current'].includes(arm));
assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
const started = performance.now(), budget = { maxAstNodes: 200000, maxAstStack: 200000, maxChunkNodes: 5000 };
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
const checkpoints = [], observations = [], inputs = [], operationCounts = { original: 0, current: 0 };
const checkpoint = label => {
  const row = { label, elapsedMs: performance.now() - started, memory: process.memoryUsage(),
    processLifetimeMaxRssKiB: process.resourceUsage().maxRSS };
  checkpoints.push(row); return row;
};
checkpoint('before-owner-admission');
let owner, parser, identity, grammar, failed = false, failure, treeCleanupCalls = 0, parserResetCalls = 0;
const retain = error => { failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error; failed = true; };
const withTree = async (spec, phase, operation) => {
  let tree, primary, operationFailed = false;
  try {
    checkpoint(spec.name + '/' + phase + '/before-parse');
    const cpu = process.threadCpuUsage(), at = performance.now();
    tree = parser.parse(spec.text);
    const parse = { wallMs: performance.now() - at, cpu: process.threadCpuUsage(cpu) };
    assert.equal(tree.rootNode.hasError, false, language + '/' + spec.name);
    checkpoint(spec.name + '/' + phase + '/after-parse');
    return await operation(tree.rootNode, parse);
  } catch (error) { operationFailed = true; primary = error; throw error; }
  finally {
    let cleanupFailure, cleanupFailed = false;
    for (const cleanup of [() => { if (typeof tree?.delete === 'function') { tree.delete(); treeCleanupCalls++; } },
      () => { parser.reset(); parserResetCalls++; }]) {
      try { cleanup(); }
      catch (error) { cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, {}, error, { secondaryPresent: true }) : error; cleanupFailed = true; }
    }
    tree = null;
    checkpoint(spec.name + '/' + phase + '/after-tree-release');
    if (cleanupFailed) throw operationFailed ? addStorageFailureContext(primary, {}, cleanupFailure, { secondaryPresent: true }) : cleanupFailure;
  }
};
const prepare = (root, spec) => {
  operationCounts[arm]++;
  return owner.prepare({ root, text: spec.text, budget, arm });
};
let unsampledResourceUsage;
try {
  owner = await loadTraversalComparisonOwner(language); identity = owner.identity;
  const { getNativeTreeSitterParser, getNativeTreeSitterIdentity } = await import('../../../src/lang/tree-sitter/native-runtime.js');
  parser = getNativeTreeSitterParser(language); assert.ok(parser, 'Original installed native parser required.');
  assert.equal(typeof parser.reset, 'function'); grammar = getNativeTreeSitterIdentity(language); assert.ok(grammar);
  checkpoint('after-owner-and-native-parser-admission');
  const specs = (await projectionWorkloads(language)).filter(spec => ['small', 'wide', 'declarations', 'deep'].includes(spec.name));
  assert.deepEqual(specs.map(spec => spec.name), ['small', 'wide', 'declarations', 'deep']);
  for (const spec of specs) {
    inputs.push({ shape: spec.name, source: spec.text, sourceSha256: digest(spec.text), sourceBytes: Buffer.byteLength(spec.text),
      utf16Units: spec.text.length, expectedNames: spec.names, expectedOccurrences: spec.calls });
    await withTree(spec, 'unsampled', (root, parse) => {
      const operation = prepare(root, spec), before = checkpoint(spec.name + '/unsampled/before-projection');
      const result = operation();
      const retained = checkpoint(spec.name + '/unsampled/result-retained');
      assert.equal(result.work.reason, null); assert.equal(result.work.frontier, 0);
      assert.ok(result.work.operations <= budget.maxAstNodes && result.work.maxFrontier <= budget.maxAstStack);
      const facts = assertProjection(result.chunks, spec), full = JSON.parse(JSON.stringify(result.chunks));
      assert.equal(digest(facts), digest(evidence(full)));
      observations.push({ shape: spec.name, parse, beforeProjection: before, resultRetained: retained,
        work: result.work, retainedEvidence: full, retainedEvidenceSha256: digest(full),
        occurrenceEvidenceSha256: digest(facts), outputBytes: Buffer.byteLength(JSON.stringify(full)) });
      checkpoint(spec.name + '/unsampled/after-validation');
    });
  }
  // Freeze the unsampled lifetime high-water before Inspector/profile storage
  // adds its own memory. This is still process-wide, including imports/parse.
  unsampledResourceUsage = process.resourceUsage(); checkpoint('all-unsampled-shapes-complete');
  for (const [index, spec] of specs.entries()) await withTree(spec, 'js-allocation-sampling', async root => {
    const operation = prepare(root, spec); let result;
    const allocation = await observeHeapAllocations({ destination, name: language + '-' + spec.name + '-' + arm, iterations: 1,
      operation: () => { result = operation(); } });
    assert.equal(result.work.reason, null); assert.equal(result.work.frontier, 0);
    const facts = assertProjection(result.chunks, spec), full = JSON.parse(JSON.stringify(result.chunks));
    assert.deepEqual(full, observations[index].retainedEvidence, 'Separate sampled pass retains every original output field.');
    assert.equal(digest(facts), observations[index].occurrenceEvidenceSha256);
    observations[index].allocations = allocation;
  });
  assert.deepEqual(operationCounts, arm === 'original' ? { original: 8, current: 0 } : { original: 0, current: 8 });
  assert.deepEqual(captureSweepSource(process.cwd()), source);
  assert.equal(digest(await fs.readFile(identity.path)), identity.currentPhysicalSha256);
} catch (error) { retain(error); }
finally {
  try { owner?.close(); } catch (error) { retain(error); }
  owner = null; parser = null;
}
if (failed) throw failure;
const finalCheckpoint = checkpoint('before-receipt-publication'), processResourceUsage = process.resourceUsage();
assert.ok(performance.now() - started < 30000, 'All original work and observations retain the30second capsule bound.');
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, issue: 1484, status: 'passed',
  historicalAuthorWorkspace: true, language, arm, source, grammar, owner: identity, budget, inputs, observations, checkpoints,
  process: { pid: process.pid, startedAtUnixMs: performance.timeOrigin,
    platform: process.platform, arch: process.arch, node: process.version, abi: process.versions.modules },
  operationCounts, unsampledResourceUsage, processResourceUsage, finalCheckpoint,
  cleanup: { treeCleanupCalls, parserResetCalls, originalTreePasses: 8, qualificationHookReleased: true,
    scope: 'Available original tree.delete and required original parser.reset invoked per tree;remaining native addon/cache finalizers belong to natural child exit,not forced GC or a fabricated allocator-free receipt.' },
  elapsedMs: performance.now() - started,
  memoryScope: 'One selected arm only in a fresh child;process.memoryUsage checkpoint bytes and OS process-lifetime maxRSS inKiB. Unsampled high-water precedes separate Inspector passes. Final high-water is observed before receipt serialization/publication and natural exit,not an exit-time sample. Bootstrap/imports/native parse/shared current callbacks/assertions/serialization are included;startup or parsing can dominate. No phase peak subtraction,native allocator peak,allocator freeing or memory reduction is inferred.',
  scope: 'Exact24230 historical gather body versus current bounded stack,with identical current semantic callbacks,all four saved comparison shapes and independently authored complete name/call-owner/range expectations. No other arm executes in this child. Parse clocks are separate observations;this is not a clean latency campaign.',
  limits: 'RSS includes JS and native resident pages;heapUsed/heapTotal are V8,external/arrayBuffers do not enumerate every native allocation. JS profiles are separate Poisson samples including collected objects,not native or exact allocations. Existing16 paired clean samples remain independent. No historical whole-adapter,cursor,full-index or universal improvement claim.' }, { createOnly: true });
