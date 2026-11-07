import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeIncrementalBundle, updateBundlesWithChunks } from '../../../src/index/build/incremental.js';
import { readIncrementalBundleSnapshot, writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { filterRawRelationsWithLexicon, getLexiconRelationFilterStats } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { buildLexiconRelationFilterReport } from '../../../src/index/build/artifacts.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('lexicon-filter-stats-roundtrip');
const dependencies = { parse: 'p1', lexical: 'l1', enrichment: 'e1', embeddings: 'v1', artifacts: 'a1' };
const relKey = 'source.py', source = 'def run():\n    return value\n';
const config = { enabled: true, relations: { enabled: true, drop: { keywords: true, literals: true, builtins: false, types: false } } };
const statsFor = dropped => getLexiconRelationFilterStats(filterRawRelationsWithLexicon(
  { usages: dropped ? ['if', 'true', 'value'] : ['value'], calls: [['run', 'value']] },
  { languageId: 'python', config, relKey }));
const report = stats => buildLexiconRelationFilterReport({ mode: 'code',
  state: { lexiconRelationFilterByFile: new Map(stats ? [[relKey, stats]] : []) } });
const apply = (cached, state, stat, abs) => reuseCachedBundle({ abs, relKey, fileIndex: 0,
  fileStat: stat, ext: '.py', fileCaps: {}, cachedBundle: cached, incrementalState: state,
  fileStart: Date.now(), mode: 'code' }).result;
try {
  for (const format of ['json', 'msgpack']) for (const kind of ['dropped', 'zero', 'absent', 'sharded']) {
    const root = path.join(dir, `${format}-${kind}`), bundleDir = path.join(root, 'bundles'), abs = path.join(root, relKey);
    await fs.mkdir(bundleDir, { recursive: true }); await fs.writeFile(abs, source);
    const stat = await fs.stat(abs), stats = kind === 'absent' ? null : statsFor(kind !== 'zero');
    const chunks = [0, 1].map(id => ({ file: relKey, id, chunkId: `chunk:${id}`, chunkUid: `uid:${id}`,
      virtualPath: relKey, start: id, end: id + 1, text: source[id],
      metaV2: { chunkId: `chunk:${id}`, chunkUid: `uid:${id}`, virtualPath: relKey, modifiers: [] } }));
    const entry = await writeIncrementalBundle({ enabled: true, bundleDir, relKey, fileStat: stat,
      fileHash: sha1(Buffer.from(source)), fileChunks: chunks, fileRelations: { imports: [] },
      dependencySignatures: dependencies, lexiconFilterStats: stats, vfsManifestRows: [], bundleFormat: format });
    assert.ok(entry);
    if (kind === 'absent') {
      const previous = await readIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey, entry });
      delete previous.bundle.lexiconFilterStats;
      Object.assign(entry, await writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey,
        bundles: [previous.bundle], format }));
    }
    if (kind === 'sharded') {
      const previous = await readIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey, entry });
      Object.assign(entry, await writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey,
        bundles: chunks.map(chunk => ({ ...previous.bundle, chunks: [chunk] })), format }));
      assert.equal(entry.bundles.length, 2, 'real persisted multi-shard input');
    }
    const state = { enabled: true, bundleDir, bundleFormat: format,
      manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, dependencySignatures: dependencies, files: { [relKey]: entry } } };
    const load = () => loadCachedBundleForFile({ repoRoot: root, runIo: fn => fn(),
      incrementalState: state, absPath: abs, relKey, fileStat: stat });
    const original = apply((await load()).cachedBundle, state, stat, abs);
    assert.ok(original?.cached, 'ordinary source/dependency-qualified Stage1 cache hit');
    assert.deepEqual(report(original.lexiconFilterStats), report(stats));
    const updated = chunks.map(chunk => ({ ...chunk, metaV2: { ...chunk.metaV2, relations: { calls: [{ targetChunkId: 'new' }] } } }));
    const update = () => updateBundlesWithChunks({ enabled: true, repoRoot: root, manifest: state.manifest,
      bundleDir, bundleFormat: format, chunks: updated, fileRelations: new Map([[relKey, { imports: ['new.py'] }]]), log: () => {} });
    const oldNames = [...entry.bundles];
    await update();
    assert.notDeepEqual(entry.bundles, oldNames, 'changed Stage2 relations publish replacement bytes');
    const loaded = await load(), reused = apply(loaded.cachedBundle, state, stat, abs);
    assert.ok(reused?.cached, 'ordinary post-Stage2 cache hit succeeds');
    assert.deepEqual(reused.lexiconFilterStats, stats);
    if (kind === 'absent') assert.equal(Object.hasOwn(loaded.cachedBundle, 'lexiconFilterStats'), false,
      'legacy absence stays absent rather than manufacturing counters from filtered relations');
    assert.deepEqual(report(reused.lexiconFilterStats), report(original.lexiconFilterStats), 'per-file report and totals survive Stage2');
    const names = [...entry.bundles];
    await update();
    assert.deepEqual(entry.bundles, names, 'unchanged Stage2 output reuses immutable snapshots');
    state.manifest.dependencySignatures = { ...dependencies, lexical: 'changed' };
    assert.equal(apply((await load()).cachedBundle, state, stat, abs), null, 'stale lexical policy cannot reuse filtered statistics');
    state.manifest.dependencySignatures = dependencies;
    await fs.writeFile(abs, source + '# changed\n');
    const stale = await loadCachedBundleForFile({ repoRoot: root, runIo: fn => fn(), incrementalState: state,
      absPath: abs, relKey, fileStat: await fs.stat(abs) });
    assert.equal(stale.cachedBundle, null, 'changed source cannot inherit a prior filter report');
  }
  for (const format of ['json', 'msgpack']) {
    const fixture = await createSemanticCacheFixture();
    try {
      const stats = statsFor(true);
      const chunk = { file: relKey, id: 0, chunkId: 'completion:0', chunkUid: 'completion:uid',
        virtualPath: relKey, start: 0, end: source.length, text: source,
        metaV2: { chunkId: 'completion:0', chunkUid: 'completion:uid', virtualPath: relKey, modifiers: [] } };
      const completed = await fixture.createFile({ file: relKey, text: source, chunks: [chunk],
        lexiconFilterStats: stats, bundleFormat: format, vfsManifestRows: [] });
      await updateBundlesWithChunks({ enabled: true, repoRoot: fixture.repoRoot, manifest: fixture.manifest,
        bundleDir: fixture.bundleDir, bundleFormat: format,
        chunks: [{ ...chunk, metaV2: { ...chunk.metaV2, relations: { calls: [{ targetChunkId: 'completion:new' }] } } }],
        fileRelations: new Map(), diskAccount: fixture.account, log: () => {} });
      assert.ok(fixture.manifest.files[relKey].bundles.every(name => name.startsWith('snapshot-')),
        'Stage2 publishes a finalized snapshot before fallback to its immutable Stage1 completion');
      const state = { enabled: true, bundleDir: fixture.bundleDir, bundleFormat: format,
        manifest: { ...fixture.manifest, files: {} } };
      const abs = path.join(fixture.repoRoot, completed.file);
      const context = { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
        dependencySignatures: fixture.dependencies, diskAccount: fixture.account,
        buildRoot: path.join(fixture.root, 'resumed'), storage: { ...fixture.storage,
          generation: { baseBuildId: 'resumed', semanticRevision: 0 } } };
      const loaded = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: fn => fn(), incrementalState: state,
        absPath: abs, relKey: completed.file, fileStat: await fs.stat(abs), semanticContext: context });
      assert.ok(loaded.cachedBundle, 'durable completion restores a missing manifest locator');
      assert.deepEqual(loaded.cachedBundle.lexiconFilterStats, stats, 'completion fallback preserves original counters');
      const reused = apply(loaded.cachedBundle, state, await fs.stat(abs), abs);
      assert.ok(reused?.cached);
      assert.deepEqual(report(reused.lexiconFilterStats), report(stats), 'completion replay preserves per-file report and totals');
      const rejected = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: fn => fn(),
        incrementalState: { ...state, manifest: { ...state.manifest, files: {} } }, absPath: abs,
        relKey, fileStat: await fs.stat(abs), semanticContext: { ...context,
          dependencySignatures: { ...fixture.dependencies, semantic: 'c'.repeat(64) } } });
      assert.equal(rejected.cachedBundle, null, 'completion fallback still rejects a stale semantic dependency identity');
    } finally { await fixture.cleanup(); }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Stage2 JSON/MessagePack, sharded inputs, ordinary reuse and completion fallback preserve qualified lexicon reports.');
