import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadTraversalComparisonOwner } from './native-traversal-comparison-owner.js';
import { projectionWorkloads, assertProjection, evidence, digest } from './native-projection-workloads.js';
import { observeTraversalWork } from './native-traversal-comparison-observation.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';

await requireBootstrap(); applyTestEnv();
const [language, destination] = process.argv.slice(2);
assert.ok(['scala', 'css', 'lua'].includes(language)); assert.ok(destination && path.isAbsolute(destination));
await fs.mkdir(destination);
const started = performance.now(), budget = { maxAstNodes: 200000, maxAstStack: 200000, maxChunkNodes: 5000 };
let owner, parser, failed = false, failure;
const observations = [], inputs = [];
const retain = error => { failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error; failed = true; };
try {
  owner = await loadTraversalComparisonOwner(language);
  const { getNativeTreeSitterParser, getNativeTreeSitterIdentity } = await import('../../../src/lang/tree-sitter/native-runtime.js');
  const { isNativeProjectionBudgetFailure } = await import('../../../src/lang/tree-sitter/chunking/projection-work.js');
  const { captureSweepSource } = await import('../../../tools/bench/ab-sweep-source.js');
  const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
  parser = getNativeTreeSitterParser(language); assert.ok(parser, 'Original installed native parser required.');
  const grammar = getNativeTreeSitterIdentity(language), all = await projectionWorkloads(language);
  const specs = all.filter(spec => ['small', 'wide', 'declarations', 'deep'].includes(spec.name));
  assert.deepEqual(specs.map(spec => spec.name), ['small', 'wide', 'declarations', 'deep']);
  const withTree = async (spec, operation) => {
    const at = performance.now(), cpu = process.threadCpuUsage(); let tree, failed = false, primary;
    try {
      tree = parser.parse(spec.text);
      const parse = { wallMs: performance.now() - at, cpu: process.threadCpuUsage(cpu) };
      const root = tree.rootNode; assert.equal(root.hasError, false, language + '/' + spec.name);
      return await operation(root, parse);
    } catch (error) { failed = true; primary = error; throw error; }
    finally {
      let cleanupFailed = false, cleanupFailure;
      for (const cleanup of [() => tree?.delete?.(), () => parser.reset?.()]) {
        try { cleanup(); }
        catch (error) { cleanupFailure = cleanupFailed ? addStorageFailureContext(cleanupFailure, {}, error, { secondaryPresent: true }) : error; cleanupFailed = true; }
      }
      if (cleanupFailed) throw failed ? addStorageFailureContext(primary, {}, cleanupFailure, { secondaryPresent: true }) : cleanupFailure;
    }
  };
  for (const spec of specs) {
    const identity = { shape: spec.name, source: spec.text, sourceSha256: digest(spec.text), sourceBytes: Buffer.byteLength(spec.text),
      utf16Units: spec.text.length, expectedNames: spec.names, expectedOccurrences: spec.calls };
    inputs.push(identity);
    const parseSamples = [], clean = { original: [], current: [] }, work = {}, allocations = {}, retained = {};
    let oracle = null;
    const check = result => {
      assert.equal(result.work.reason, null); assert.equal(result.work.frontier, 0);
      const facts = assertProjection(result.chunks, spec), full = JSON.parse(JSON.stringify(result.chunks));
      if (oracle) assert.deepEqual(full, oracle, 'Same complete current semantic callbacks retain every field/occurrence in both algorithms.');
      else oracle = full;
      assert.equal(digest(facts), digest(evidence(oracle))); return full;
    };
    for (let index = 0; index < 16; index++) await withTree(spec, (root, parse) => {
      parseSamples.push(parse);
      for (const arm of index % 2 ? ['current', 'original'] : ['original', 'current']) {
        const operation = owner.prepare({ root, text: spec.text, budget, arm });
        const beforeMemory = process.memoryUsage(), cpu = process.threadCpuUsage(), at = performance.now();
        const result = operation();
        const wallMs = performance.now() - at, used = process.threadCpuUsage(cpu), afterMemory = process.memoryUsage();
        clean[arm].push({ wallMs, cpu: used, gatherWallMs: result.gatherWallMs, postProjectionWallMs: result.postProjectionWallMs,
          beforeMemory, afterMemory, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
        check(result); // exact evidence, serialization and hashes are outside clocks
      }
    });
    await withTree(spec, root => {
      for (const arm of ['original', 'current']) {
        const observed = observeTraversalWork(root, observeStack => owner.run({ root, text: spec.text, budget, arm, instrumented: true, observeStack }));
        check(observed.result);
        assert.ok(observed.outerStack.maximum <= budget.maxAstStack); assert.equal(observed.outerStack.finalLength, 0);
        if (arm === 'current') assert.ok(observed.result.work.operations <= budget.maxAstNodes && observed.result.work.maxFrontier <= budget.maxAstStack);
        work[arm] = { ...observed, result: undefined, ledger: observed.result.work };
      }
    });
    // Each profile starts from its own fresh native tree. Parsing happens before
    // inspector sampling; exactly one actual complete post-parse pass is sampled.
    for (const arm of ['original', 'current']) await withTree(spec, async root => {
      let result; const operation = owner.prepare({ root, text: spec.text, budget, arm });
      allocations[arm] = await observeHeapAllocations({ destination, name: language + '-' + spec.name + '-' + arm, iterations: 1,
        operation: () => { result = operation(); } });
      retained[arm] = check(result);
    });
    assert.deepEqual(retained.current, retained.original);
    observations.push({ ...identity, budget, parseSamples, clean, work, allocations,
      retainedEvidence: retained.current, retainedEvidenceSha256: digest(retained.current), outputBytes: Buffer.byteLength(JSON.stringify(retained.current)),
      equivalentCompleteEvidence: true,
      clockScope: 'Parse separately measured;clean clocks and heap sampling include actual gather/current callback/projection/call-fact work. Shared work/name context and baseline callback-adapter setup precede both clocks and sampling;no AST traversal in setup. Assertions/serialization/hash/cleanup excluded. Scala gather includes toChunk/name/scope callbacks;CSS/Lua gather is selection then current mapper/call-facts.',
      cacheScope: 'Fresh native tree per paired sample, same tree within pair, first arm alternates. Second arm may reuse that tree native wrapper cache;memo/name/work state is fresh for each arm. Allocation profiles use separate fresh parsed trees, one pass each. No result/file/memo cache or cold-OS claim.' });
  }
  const flat = specs.find(spec => spec.name === 'declarations'), tiny = { maxAstNodes: 1, maxAstStack: 1, maxChunkNodes: 5000 };
  const negative = await withTree(flat, root => {
    const outcomes = {};
    for (const arm of ['original', 'current']) {
      outcomes[arm] = observeTraversalWork(root, observeStack => {
        try { return owner.run({ root, text: flat.text, budget: tiny, arm, instrumented: true, negative: true, observeStack }); }
        catch (error) {
          if (!isNativeProjectionBudgetFailure(error)) throw error;
          return { rejectedByOriginalBudgetOwner: true, code: error.code, reason: error.reason, work: error.projectionWork };
        }
      });
    }
    const original = outcomes.original, current = outcomes.current;
    assert.ok(original.outerStack.maximum > tiny.maxAstStack, 'Positively observe historical whole-frontier materialization before its next budget check.');
    assert.ok(original.reads.namedChild > 0);
    if (language === 'lua') {
      assert.equal(original.result.selectionComplete, true); assert.equal(original.result.selected.length, flat.names.length);
      assert.equal(original.result.reason, null, 'Historical Lua ignores the requested tiny budget and retains its fixed200000 limit.');
    } else {
      assert.equal(original.result.selectionComplete, false); assert.equal(original.result.reason, 'maxAstStack');
    }
    assert.equal(current.result.rejectedByOriginalBudgetOwner, true);
    assert.equal(current.result.code, 'ERR_TREE_SITTER_PROJECTION_BUDGET'); assert.equal(current.result.reason, 'maxAstNodes');
    assert.equal(current.reads.namedChild, 0); assert.equal(current.reads.namedChildren, 0);
    assert.equal(current.outerStack.maximum, 1); assert.equal(current.outerStack.finalLength, 0); assert.equal(current.result.work.frontier, 0);
    return { sourceSha256: digest(flat.text), budget: tiny, outcomes,
      scope: 'Separate negative selection control, never a performance/equivalent-evidence pass;actual old late maxAstStack rejection or Lua ignored configured limits, versus current original budget error before child retrieval. No failed command counted as acceptance.' };
  });
  assert.deepEqual(captureSweepSource(process.cwd()), source);
  assert.equal(digest(await fs.readFile(owner.identity.path)), owner.identity.currentPhysicalSha256);
  assert.ok(performance.now() - started < 30000, 'Entire original child including observations stays below30seconds.');
  await atomicWriteJson(path.join(destination, 'receipt.json'), { schemaVersion: 1, issue: 1484, status: 'passed',
    historicalAuthorWorkspace: true, language, source, grammar, owner: owner.identity, inputs, observations, negative,
    elapsedMs: performance.now() - started, processResourceUsage: process.resourceUsage(),
    scope: 'Exact24230 generic/CSS/Lua gather algorithm versus current bounded pre-expansion stack traversal, same native trees/current predicates/semantic callbacks and full retained facts. Original18 current-entrypoint/publication capsules remain independent evidence.',
    limits: 'No implemented native cursor, historical whole-adapter behavior, universal speedup, native-parse budget, native peak/freeing or full-index claim. OS maxRSS is process lifetime;JS sampled allocations are separate, not exact native allocations.' }, { createOnly: true });
} catch (error) { retain(error); }
finally {
  try { owner?.close(); } catch (error) { retain(error); }
}
if (failed) throw failure;
