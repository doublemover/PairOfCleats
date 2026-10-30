import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
import { getNativeTreeSitterParser, getNativeTreeSitterIdentity } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { projectionWorkloads, digest, assertProjection, evidence } from './native-projection-workloads.js';
import { nativeBuild, nativeOptions, highBudget, observeNative, cleanSamples } from './native-projection-observation.js';
import { bundleRefresh, publishOccurrences, observeIo } from './native-projection-publication.js';

await requireBootstrap(); applyTestEnv();
const [language, cohort, destination] = process.argv.slice(2);
assert.ok(['scala', 'css', 'lua'].includes(language)); assert.ok(['projection', 'publication'].includes(cohort));
assert.ok(destination && path.isAbsolute(destination)); await fs.mkdir(destination);
const workRoot = path.join(destination, 'work'); await fs.mkdir(workRoot);
const rootIdentity = await fs.lstat(workRoot, { bigint: true }), logger = createLoggerScope(), logs = [];
logger.setProgressHandlers({ log(message) { assert.ok(logs.length < 128); logs.push(message); } });
const specs = await projectionWorkloads(language), observations = [], controls = [];
const started = performance.now(), memoryBefore = process.memoryUsage();
let failed = false, primary, report;
try {
  const parser = getNativeTreeSitterParser(language); assert.ok(parser, 'actual installed native grammar is required');
  for (const spec of specs) {
    const tree = parser.parse(spec.text);
    try { assert.equal(tree.rootNode.hasError, false, language + '/' + spec.name); }
    finally { tree.delete?.(); parser.reset?.(); }
  }
  if (cohort === 'projection') {
    for (const spec of specs) for (const useQueries of language === 'scala' ? [false, true] : [false]) {
      const options = nativeOptions(language, { useQueries }), operation = () => nativeBuild(language, spec.text, options);
      const check = chunks => assertProjection(chunks, spec);
      const clean = await cleanSamples(operation, check);
      const expected = evidence(clean.result), observed = await observeNative(language, operation);
      assert.deepEqual(assertProjection(observed.result, spec), expected);
      assert.equal(observed.parse.length, 1);
      const work = observed.work, budget = highBudget(language);
      assert.ok(work.projectionOperations <= budget.maxAstNodes && work.projectionMaxFrontier <= budget.maxAstStack);
      assert.ok(Object.values(observed.reads).reduce((sum, value) => sum + value, 0) <= work.projectionOperations);
      if (useQueries) assert.ok(work.queryExecutions > 0, 'actual Query execution, not a cached-null/fallback route');
      const exact = { maxAstNodes: work.projectionOperations, maxAstStack: work.projectionMaxFrontier,
        maxChunkNodes: work.projectionOutputRows };
      assert.ok(Object.values(exact).every(value => Number.isSafeInteger(value) && value > 0));
      const exactOperation = () => nativeBuild(language, spec.text, nativeOptions(language, { useQueries, budget: exact }));
      const equivalent = await cleanSamples(exactOperation, chunks => assert.deepEqual(check(chunks), expected));
      const allocations = await observeHeapAllocations({ destination, name: spec.name + '-' + useQueries,
        iterations: 8, operation });
      check(operation());
      observations.push({ shape: spec.name, sourceSha256: digest(spec.text), sourceBytes: Buffer.byteLength(spec.text),
        utf16Units: spec.text.length, names: spec.names, expectedOccurrences: spec.calls,
        outputBytes: Buffer.byteLength(JSON.stringify(clean.result)), evidenceSha256: digest(expected),
        useQueries, route: useQueries ? 'observed-native-query' : language === 'scala' ? 'native-walk' : 'specialized-native-reparse',
        generousBudget: budget, generousSamples: clean.samples, exactBudget: exact, exactSamples: equivalent.samples,
        equivalentEvidence: true, nativeWork: { ...observed, result: undefined }, allocations,
        cacheScope: 'cache disabled;all clean samples reparse in this process;no cold-OS or cache-hit claim' });
    }
    const wide = specs.find(spec => spec.name === 'wide');
    const limited = await observeNative(language, () => nativeBuild(language, wide.text,
      nativeOptions(language, { budget: { ...highBudget(language), maxAstNodes: 1, maxAstStack: 1 } })));
    assert.equal(limited.result.length, 1); assert.equal(limited.result[0].start, 0); assert.equal(limited.result[0].end, wide.text.length);
    assert.deepEqual(limited.result[0].meta.syntaxCalls, []);
    assert.match(limited.result[0].meta.syntaxCallCoverage, /^partial-projection-budget:/u);
    assert.ok(limited.work.projectionOperations <= 1 && limited.work.projectionMaxFrontier <= 1);
    controls.push({ type: 'low-budget-negative-separate-from-performance', evidence: evidence(limited.result),
      nativeWork: { ...limited, result: undefined } });
    if (language === 'scala') {
      const cacheRoot = path.join(workRoot, 'native-cache'); await fs.mkdir(cacheRoot);
      const clearMemory = () => treeSitterState.chunkCache.clear();
      const clearAll = () => { clearMemory(); treeSitterState.persistentChunkCacheMemo.clear(); treeSitterState.persistentChunkCacheMisses.clear(); };
      for (const spec of [specs.find(row => row.name === 'saved'), specs.find(row => row.name === 'edited')]) {
        const options = nativeOptions(language, { cache: true, cacheRoot, key: digest(spec.text) });
        const operation = () => nativeBuild(language, spec.text, options);
        assertProjection(operation(), spec);
        for (const mode of ['persisted-file-admission', 'memory-hit', 'persisted-memo-hit']) {
          let hits;
          const prepare = () => {
            if (mode === 'persisted-file-admission') clearAll();
            else { assertProjection(operation(), spec); if (mode === 'persisted-memo-hit') clearMemory(); }
            hits = { memory: treeSitterState.metrics.chunkCacheHits || 0, persisted: treeSitterState.metrics.chunkCachePersistentHits || 0 };
          };
          const clean = await cleanSamples(operation, chunks => {
            assertProjection(chunks, spec);
            const metric = mode === 'memory-hit' ? 'chunkCacheHits' : 'chunkCachePersistentHits';
            assert.equal(treeSitterState.metrics[metric], (mode === 'memory-hit' ? hits.memory : hits.persisted) + 1);
          }, { prepare });
          prepare(); const admitted = await observeNative(language, operation);
          assertProjection(admitted.result, spec); assert.equal(admitted.parse.length, 0);
          assert.equal(Object.values(admitted.reads).reduce((sum, value) => sum + value, 0), 0);
          observations.push({ shape: spec.name, mode, sourceSha256: digest(spec.text), evidenceSha256: digest(evidence(clean.result)),
            samples: clean.samples, nativeWork: { ...admitted, result: undefined },
            scope: 'actual supported native chunk-cache reader with untimed per-input priming/clears;OS file cache uncontrolled' });
        }
      }
    } else controls.push({ type: 'cache-not-supported-by-specialized-owner', language,
      scope: 'CSS/Lua direct owners always reparse here;no synthetic warm-cache phase' });
  } else {
    const saved = specs.find(row => row.name === 'saved'), edited = specs.find(row => row.name === 'edited');
    const refresh = await bundleRefresh(language, path.join(workRoot, 'bundles-clean'), saved, edited);
    observations.push({ type: 'canonical-bundle-partial-refresh', ...refresh });
    const io = await observeIo(() => bundleRefresh(language, path.join(workRoot, 'bundles-io'), saved, edited));
    observations.push({ type: 'separate-bundle-IO', counts: io.counts, scope: io.scope });
    if (language !== 'css') {
      const wide = specs.find(row => row.name === 'wide');
      for (const compression of [null, 'gzip']) observations.push(await logger.run(() => publishOccurrences(language,
        path.join(workRoot, 'calls-' + (compression || 'plain')), wide, compression)));
      const ioPublished = await observeIo(() => logger.run(() => publishOccurrences(language, path.join(workRoot, 'calls-io'), wide)));
      assert.ok(ioPublished.counts.outputStreams > 0 && ioPublished.counts.peakSpillBytes > 0
        && ioPublished.counts.maximumSingleRunBytes > 0 && ioPublished.counts.peakOutputQueuedBytes > 0,
      'the original output streams and spill writes must actually be observed');
      observations.push({ type: 'separate-publication-and-page-IO', counts: ioPublished.counts, scope: ioPublished.scope });
    } else controls.push({ type: 'CSS-has-no-invocation-occurrences', scope: 'no fabricated call-site publication or query-page claim' });
  }
  report = { language, cohort, observations, controls, logs, grammar: getNativeTreeSitterIdentity(language),
    inputs: specs.map(spec => ({ name: spec.name, sourceSha256: digest(spec.text), bytes: Buffer.byteLength(spec.text),
      savedPath: spec.path || null, savedLfSha256: spec.sha256 || null, physicalSavedSha256: spec.physicalSha256 || null })),
    memoryBefore, memoryAfter: process.memoryUsage(), processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
    workWallMs: performance.now() - started,
    resourceScope: 'one bounded fresh child;process-lifetime OS RSS high-water and endpoint JS/native external counters,not per-phase/native peak attribution',
    limits: 'saved sources are repository fixtures,not a broad real-world corpus;no historical speedup claim;separate clean/proxy/Poisson allocation passes;publication bundle work is not a full-index incremental campaign' };
} catch (error) { failed = true; primary = error; throw error; }
finally {
  let cleanupFailed = false, cleanupFailure;
  for (const action of [() => logger.close(), async () => {
    if (failed) observeStorageResource(primary, { phase: 'native-projection-cost-cleanup' }).requireSettled();
    const after = await fs.lstat(workRoot, { bigint: true });
    assert.ok(after.isDirectory() && !after.isSymbolicLink() && after.dev === rootIdentity.dev && after.ino === rootIdentity.ino);
    assert.equal(path.dirname(workRoot), destination); await fs.rm(workRoot, { recursive: true, force: false });
  }]) {
    try { await action(); }
    catch (cleanup) { cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, {}, cleanup, { secondaryPresent: true }) : cleanup; cleanupFailed = true; }
  }
  if (cleanupFailed) {
    if (failed) throw addStorageFailureContext(primary, {}, cleanupFailure, { secondaryPresent: true });
    throw cleanupFailure;
  }
}
await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, status: 'passed', historicalAuthorWorkspace: true,
  node: process.version, platform: process.platform, pid: process.pid, totalWithCleanupMs: performance.now() - started, report }, { createOnly: true });
