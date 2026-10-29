import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { normalizeRiskConfig } from '../../../../src/index/risk.js';
import { buildDependencySignatures, buildIncrementalSignature } from '../../../../src/index/build/indexer/signatures.js';
import { loadIncrementalState } from '../../../../src/index/build/incremental/planning.js';
import { persistIncrementalManifest } from '../../../../src/index/build/incremental/manifest-codec.js';
import { readCachedBundle } from '../../../../src/index/build/incremental.js';
import { buildRiskSummaries } from '../../../../src/index/risk-interprocedural/summaries.js';
import { runTreeSitterScheduler } from '../../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
applyTestEnv();
const counter = Symbol.for('test.risk.replay.chunking'); globalThis[counter] = 0;
const hook = registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url.endsWith('/file-processor/cpu/scheduler-chunking.js')
      ? { ...result, url: result.url + '?risk-replay-counter' } : result;
  },
  load(url, context, next) {
    if (url.endsWith('/scheduler-chunking.js?risk-replay-counter')) {
      const original = JSON.stringify(url.split('?')[0] + '?risk-replay-actual');
      return { format: 'module', shortCircuit: true, source: `export * from ${original};
        import { chunkWithScheduler as actual } from ${original};
        export const chunkWithScheduler = async (...args) => { globalThis[Symbol.for('test.risk.replay.chunking')]++; return actual(...args); };` };
    }
    return next(url, context);
  }
});
const { createFileProcessorForTest, createScannedFileEntry } = await import('../../file-processor/file-processor-fixture.js');
const { dir: root } = await prepareIsolatedTestCacheDir('risk-policy-replay-consumer');
try {
  const filename = path.join(root, 'work.js'), rulesPath = path.join(root, 'rules.json');
  const text = 'function work() {\n const value = source_a;\n SINK(value);\n}\n'; await fs.writeFile(filename, text);
  const entry = createScannedFileEntry({ abs: filename, rel: 'work.js', stat: await fs.stat(filename), ext: '.js', lines: 4 });
  const policy = version => ({ sources: [{ id: 'source.' + version, name: 'source', patterns: ['SOURCE_A'] }],
    sinks: [{ id: 'sink.' + version, name: 'sink', patterns: ['SINK'] }], sanitizers: [] });
  const raw = { rules: { includeDefaults: false, rulesPath }, caps: { maxMs: 1000 } };
  const languageOptions = { javascript: { parser: 'babel' }, treeSitter: { enabled: true, strict: true,
    scheduler: { maxWorkers: 1, maxWorkersPerGrammar: 1 } } };
  const treeSitterScheduler = await runTreeSitterScheduler({ mode: 'code', runtime: { root, languageOptions },
    entries: [filename], outDir: path.join(root, 'scheduler') });
  const run = async (regex = { flags: 'i' }) => {
    const riskConfig = normalizeRiskConfig({ ...raw, regex }, { rootDir: root });
    const runtime = { root, languageOptions, indexingConfig: { riskRules: raw.rules, riskRegex: regex }, riskConfig };
    const dependencySignatures = buildDependencySignatures(runtime, 'code', 'fixture');
    const state = await loadIncrementalState({ repoCacheRoot: path.join(root, 'cache'), mode: 'code', enabled: true,
      cacheSignature: buildIncrementalSignature(runtime, 'code', 'fixture'), tokenizationKey: 'fixture', dependencySignatures });
    const stats = { chunks: 0, tokens: 0, seq: 0 }, before = globalThis[counter];
    const processor = createFileProcessorForTest({ root, languageOptions, overrides: {
      incrementalState: state, treeSitterScheduler, relationsEnabled: true, riskAnalysisEnabled: true, riskConfig, tokenizationStats: stats } });
    const result = await processor.processFile(entry, 0);
    assert.ok(result?.manifestEntry); state.manifest.files['work.js'] = result.manifestEntry;
    await persistIncrementalManifest(state.manifestPath, state.manifest);
    const { cachedBundle } = await readCachedBundle({ repoRoot: root, enabled: true, absPath: filename, relKey: 'work.js', fileStat: entry.stat,
      manifest: state.manifest, bundleDir: state.bundleDir, bundleFormat: state.bundleFormat });
    assert.deepEqual(cachedBundle.chunks.map(chunk => chunk.docmeta.risk), JSON.parse(JSON.stringify(result.chunks.map(chunk => chunk.docmeta.risk ?? null))).map(value => value ?? undefined));
    const summaries = buildRiskSummaries({ chunks: result.chunks, runtime: { riskInterproceduralEnabled: true,
      riskInterproceduralConfig: { summaryOnly: false } }, mode: 'code' }).rows;
    return { result, stats, state, checkpoint: cachedBundle.parseCheckpoint, lexical: cachedBundle.lexicalCheckpoint,
      chunkings: globalThis[counter] - before, summaries, dependencySignatures, riskConfig };
  };
  await fs.writeFile(rulesPath, JSON.stringify(policy('A'))); const first = await run();
  assert.ok(first.chunkings > 0); assert.ok(first.result.chunks.some(chunk => chunk.docmeta.risk?.flows?.length));
  const rulePairs = run => run.summaries.flatMap(row => row.signals.localFlows.map(flow => [flow.sourceRuleId, flow.sinkRuleId]));
  assert.deepEqual(rulePairs(first), [['source.A', 'sink.A']]);
  const stat = await fs.stat(rulesPath); await fs.writeFile(rulesPath, JSON.stringify(policy('B'))); await fs.utimes(rulesPath, stat.atime, stat.mtime);
  const changed = await run();
  assert.equal(changed.result.cached, false); assert.equal(changed.chunkings, 0, 'enrichment-only replay uses the admitted parse checkpoint');
  assert.ok(changed.stats.lexicalCheckpoint.productHits > 0, 'complete lexical products are reused');
  assert.deepEqual(changed.checkpoint, first.checkpoint); assert.deepEqual(changed.lexical, first.lexical);
  assert.deepEqual(rulePairs(changed), [['source.B', 'sink.B']]);
  assert.equal(changed.dependencySignatures.parse, first.dependencySignatures.parse);
  assert.equal(changed.dependencySignatures.lexical, first.dependencySignatures.lexical);
  assert.notEqual(changed.dependencySignatures.enrichment, first.dependencySignatures.enrichment);
  const warm = await run(); assert.equal(warm.result.cached, true); assert.equal(warm.chunkings, 0); assert.deepEqual(rulePairs(warm), rulePairs(changed));
  const sensitive = await run({ flags: '' }); assert.equal(sensitive.result.cached, false); assert.equal(sensitive.chunkings, 0);
  assert.deepEqual(rulePairs(sensitive), []); assert.deepEqual(sensitive.checkpoint, first.checkpoint);
  const beforeFailure = await fs.readFile(sensitive.state.manifestPath);
  await fs.writeFile(rulesPath, '{'); await assert.rejects(run(), error => error.riskRuleInput?.reason === 'invalid-json');
  assert.deepEqual(await fs.readFile(sensitive.state.manifestPath), beforeFailure, 'failed requested policy never writes a complete zero-flow generation');
  await fs.writeFile(rulesPath, JSON.stringify({ sources: [], sinks: [], sanitizers: [] }));
  const empty = await run(); assert.equal(empty.riskConfig.rules.inputReceipt.outcome, 'complete'); assert.deepEqual(rulePairs(empty), []);
  await fs.writeFile(rulesPath, JSON.stringify(policy('B'))); assert.deepEqual(rulePairs(await run()), [['source.B', 'sink.B']]);
} finally { hook.deregister(); delete globalThis[counter]; await fs.rm(root, { recursive: true, force: true }); }
console.log('Effective risk policy changes re-enrich real persisted source while preserving parse/lexical reuse, exact rule evidence and requested-input failures.');
