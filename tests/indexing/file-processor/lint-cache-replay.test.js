import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLintPolicy, isReusableLintOutcome } from '../../../src/index/lint-policy.js';
import { createDisabledAnalysisPolicy, createProcessChunksFixtureContext, processFixtureChunks } from './process-chunks-fixture.js';
import { writeIncrementalBundle } from '../../../src/index/build/incremental/writeback.js';
import { readBundleFile } from '../../../src/shared/bundle-io.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const parent = resolveTestCachePath(process.cwd(), 'lint-cache-replay');
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'owned-'));
const relative = 'same.js', source = 'function f() { return 1; missing(); }\n';
const policy = createLintPolicy(root), alternate = createLintPolicy(root, { 'no-unreachable': 0 });
const entries = new Map(); let reads = 0, writes = 0;
const cache = { get(key) { reads++; return entries.get(key); }, set(key, value) { writes++; entries.set(key, value); } };
const processSource = async (text = source, lintPolicy = policy) => {
  const { context } = createProcessChunksFixtureContext({ text, rel: relative, tokenizeEnabled: false,
    analysisPolicy: createDisabledAnalysisPolicy(), riskAnalysisEnabled: false, typeInferenceEnabled: false,
    overrides: { root, lintEnabled: true, lintPolicy, lintCache: cache } });
  return processFixtureChunks(context);
};
try {
  const first = await processSource();
  assert.equal(first.lintOutcome.status, 'completed'); assert.equal(first.lintOutcome.clean, false);
  assert.ok(first.chunks.some(chunk => chunk.lint.some(row => row.ruleId === 'no-unreachable')));
  assert.ok(first.chunks.every(chunk => chunk.docmeta.lintOutcome.source.hash === first.lintOutcome.source.hash));
  assert.equal(writes, 1); assert.equal(reads, 1);
  const warm = await processSource();
  assert.equal(writes, 1); assert.equal(reads, 2); assert.deepEqual(warm.lintOutcome, first.lintOutcome);
  assert.deepEqual(warm.chunks.map(chunk => chunk.lint), first.chunks.map(chunk => chunk.lint));
  const edited = await processSource(source + '// exact source changed\n');
  assert.equal(writes, 2); assert.notEqual(edited.lintOutcome.source.hash, first.lintOutcome.source.hash);
  const changed = await processSource(source, alternate);
  assert.equal(writes, 3); assert.equal(changed.lintOutcome.clean, true);
  assert.notEqual(changed.lintOutcome.policy.identity, first.lintOutcome.policy.identity);
  assert.equal(changed.lintOutcome.source.hash, first.lintOutcome.source.hash);
  await processSource(source, alternate); assert.equal(writes, 3);
  const firstKey = [...entries.keys()][0];
  const original = entries.get(firstKey);
  entries.set(firstKey, { messages: [], receipt: { ...original.receipt, status: 'failed', reason: 'lint-execution-failed', clean: false } });
  const recovered = await processSource();
  assert.equal(writes, 4); assert.equal(recovered.lintOutcome.status, 'completed');
  assert.ok(recovered.chunks[0].lint.length, 'a failed cached result cannot hide the positive diagnostic');

  const filename = path.join(root, relative); await fs.writeFile(filename, source);
  const stat = await fs.stat(filename), bundleDir = path.join(root, 'bundles');
  const manifest = { files: {}, dependencySignatures: null };
  const entry = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: relative, fileStat: stat,
    fileHash: first.lintOutcome.source.hash, fileChunks: first.chunks, lintOutcome: first.lintOutcome,
    fileRelations: {}, vfsManifestRows: first.vfsManifestRows || [], bundleFormat: 'json' });
  assert.ok(entry, 'actual immutable bundle publication must complete');
  assert.equal(entry.bundles.length, 1);
  const read = await readBundleFile(path.join(bundleDir, entry.bundles[0]), { format: 'json', repoRoot: root });
  assert.equal(read.ok, true); assert.deepEqual(read.bundle.lintOutcome, first.lintOutcome);
  manifest.files[relative] = entry;
  const reuse = (bundle = read.bundle, lintPolicy = policy) => reuseCachedBundle({ abs: filename, root, relKey: relative,
    fileIndex: 0, fileStat: stat, fileHash: first.lintOutcome.source.hash, fileHashAlgo: 'sha256', ext: '.js', fileCaps: {},
    cachedBundle: bundle, incrementalState: { manifest }, fileStructural: null, toolInfo: null,
    analysisPolicy: createDisabledAnalysisPolicy(), fileStart: Date.now(), knownLines: 1, fileLanguageId: 'javascript',
    mode: 'code', lintEnabled: true, lintPolicy });
  assert.ok(reuse().result, 'completed source-qualified lint evidence survives actual bundle read-back');
  assert.equal(reuse(read.bundle, alternate).result, null, 'policy-only changes invalidate enrichment reuse');
  for (const status of ['failed', 'unavailable', 'canceled']) {
    const stale = structuredClone(read.bundle);
    stale.lintOutcome.status = status; stale.lintOutcome.reason = 'fixture'; stale.lintOutcome.clean = false;
    assert.equal(reuse(stale).result, null, status + ' must not become a clean replay');
  }
  const missing = structuredClone(read.bundle); delete missing.lintOutcome;
  assert.equal(reuse(missing).result, null);
  const wrongSource = structuredClone(read.bundle); wrongSource.chunks[0].docmeta.lintOutcome.source.hash = 'a'.repeat(64);
  assert.equal(reuse(wrongSource).result, null, 'chunk evidence must agree with its whole-file receipt');
  assert.equal(isReusableLintOutcome({ ...first.lintOutcome, producer: undefined }, policy), false);
  console.log('whole-file lint cache, explicit failure recovery and immutable receipt replay passed');
} finally {
  const relativeRoot = path.relative(path.resolve(parent), path.resolve(root));
  assert.ok(relativeRoot && relativeRoot !== '..' && !relativeRoot.startsWith('..' + path.sep) && !path.isAbsolute(relativeRoot));
  await fs.rm(root, { recursive: true, force: true });
}
