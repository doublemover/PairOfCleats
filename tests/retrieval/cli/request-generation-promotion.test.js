import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import Database from 'better-sqlite3';
import { open } from 'lmdb';
import { Packr } from 'msgpackr';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { createImportExtraction } from '../../../src/shared/import-extraction.js';
import { getRepoCacheRoot, loadUserConfig, resolveSqlitePaths, resolveLmdbPaths } from '../../../src/shared/dict-utils.js';
import { SCHEMA_VERSION, CREATE_TABLES_BASE_SQL } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { createInsertStatements } from '../../../src/storage/sqlite/build/statements.js';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';
import { LMDB_SCHEMA_VERSION, LMDB_META_KEYS, LMDB_ARTIFACT_KEYS } from '../../../src/storage/lmdb/schema.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';
import { attachDenseVectorLoader } from '../../../src/retrieval/cli/ann-backends.js';
import { createIndexCache } from '../../../src/retrieval/index-cache.js';
import { INTERNAL_QUERY_CACHE_BYPASS } from '../../../src/retrieval/query-cache-experiment.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const backend = process.env.PAIROFCLEATS_TEST_ID?.split('retrieval/cli/request-generation-promotion/')[1];
assert.ok(['memory', 'sqlite', 'lmdb'].includes(backend));
const { dir } = await prepareIsolatedTestCacheDir(`request-generation-promotion-${backend}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const config = loadUserConfig(repo), cacheRoot = getRepoCacheRoot(repo, config);
const pointerPath = path.join(cacheRoot, 'builds/current.json'), generations = {};
const packr = new Packr();
const controlledFacts = (imports, usages) => ({ imports, usages,
  importExtraction: createImportExtraction({ entries: imports, text: imports.map(value => `import '${value}';`).join('\n'),
    producerId: 'controlled-generation-fixture', scope: 'authored-static-imports', state: 'complete',
    parser: { id: 'controlled-generation-fixture', version: '1', available: true } }) });
for (const [label, stamp] of [['A', '120000'], ['B', '120001']]) {
  const roots = {}, ids = {};
  for (const [mode, suffix] of [['code', '11111111'], ['prose', '22222222'], ['extracted-prose', '22222222']]) {
    const buildId = `20261029T${stamp}Z_abcd_abcdef1_${suffix}`;
    const buildRoot = path.join(cacheRoot, 'builds', buildId);
    const indexDir = await createCompatibilityIndex(buildRoot, { mode, buildId,
      compatibilityKey: 'generation-promotion-compatible', profileId: 'default' });
    const row = { id: 0, file: `${mode}.js`, chunkUid: `${label}:${mode}`, name: `${label}-${mode}`,
      start: 0, end: 5, tokens: ['alpha'], phraseTokens: ['alpha'], weight: 1,
      metaV2: { schemaVersion: META_V2_SCHEMA_VERSION }, codeRelations: controlledFacts([`${label}-import`], [`${label}-use`]) };
    const postings = { vocab: ['alpha'], postings: [[[0, 1]]], docLengths: [1], totalDocs: 1, avgDocLen: 1 };
    await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([row]));
    const state = JSON.parse(await fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8'));
    await fs.writeFile(path.join(buildRoot, 'build_state.json'), JSON.stringify({ buildId, configHash: label }));
    const manifestPath = path.join(indexDir, 'pieces/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.pieces.push({ name: 'dense_vectors', type: 'dense', format: 'json', path: 'merged.json' });
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(path.join(indexDir, 'merged.json'), JSON.stringify({ dims: 2, model: label,
      vectors: [[label === 'A' ? 1 : 9, 2]], count: 1 }));
    roots[mode] = buildRoot; ids[mode] = buildId;
    if (backend === 'sqlite') {
      const paths = resolveSqlitePaths(repo, config, { indexRoot: buildRoot });
      const filename = mode === 'code' ? paths.codePath : mode === 'prose' ? paths.prosePath : paths.extractedProsePath;
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const db = new Database(filename);
      try {
        db.exec(CREATE_TABLES_BASE_SQL); db.pragma(`user_version=${SCHEMA_VERSION}`); writeSqliteIndexFormat(db);
        const s = createInsertStatements(db);
        s.insertChunk.run(buildChunkRow(row, mode, 0)); s.insertDocLength.run(mode, 0, 1);
        s.insertTokenVocab.run(mode, 0, 'alpha'); s.insertTokenPosting.run(mode, 0, 0, 1);
        s.insertTokenStats.run(mode, 1, 1);
      } finally { db.close(); }
    } else if (backend === 'lmdb' && mode !== 'extracted-prose') {
      const paths = resolveLmdbPaths(repo, config, { indexRoot: buildRoot });
      const filename = mode === 'code' ? paths.codePath : paths.prosePath;
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const db = open({ path: filename, mapSize: 1024 * 1024 });
      try {
        for (const [key, value] of [[LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION],
          [LMDB_META_KEYS.mode, mode], [LMDB_META_KEYS.chunkCount, 1],
          [LMDB_ARTIFACT_KEYS.chunkMeta, [row]], [LMDB_ARTIFACT_KEYS.tokenPostings, postings],
          [LMDB_ARTIFACT_KEYS.indexState, state]]) db.putSync(key, packr.pack(value));
      } finally { await closeLmdbDatabase(db, db.close); }
      assert.ok(fsSync.existsSync(path.join(filename, 'data.mdb')), 'real native LMDB fixture writer publishes the production directory shape');
    }
  }
  generations[label] = { roots, ids, pointer: JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId: ids.prose, buildRoot: roots.prose, buildRootsByMode: roots, modes: Object.keys(roots) }) };
}
const key = Symbol.for('poc.test.request-generation-promotion');
globalThis[key] = { phase: null, observed: [], loaded: null, signatures: [],
  promote(phase, value) {
    this.observed.push(phase);
    if (phase === 'signature') this.signatures.push(value);
    if (phase === 'metadata') this.loaded = value;
    if (this.phase === phase) fsSync.writeFileSync(pointerPath, generations.B.pointer);
  } };
const wrappers = {
  '/src/index/as-of.js': ['resolveAsOfContext', 'admission', false],
  '/src/retrieval/cli/run-search/backend-context.js': ['createBackendContextWithTracking', 'backend', true],
  '/src/retrieval/cli-dictionary.js': ['loadDictionary', 'dictionary', true],
  '/src/retrieval/cli/load-indexes.js': ['loadSearchIndexes', 'metadata', true],
  '/src/retrieval/cli-index.js': ['getIndexSignature', 'signature', true]
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const value = next(specifier, context);
    if (!context.parentURL?.endsWith('/src/retrieval/cli/run-search/plan-runner.js')) return value;
    const match = Object.keys(wrappers).find(suffix => value.url.endsWith(suffix));
    return match ? { url: 'poc:generation:' + encodeURIComponent(value.url), shortCircuit: true } : value;
  },
  load(url, context, next) {
    if (!url.startsWith('poc:generation:')) return next(url, context);
    const real = decodeURIComponent(url.slice('poc:generation:'.length));
    const [name, phase, async] = wrappers[Object.keys(wrappers).find(suffix => real.endsWith(suffix))];
    return { format: 'module', shortCircuit: true, source: `export * from ${JSON.stringify(real)};
      import {${name} as original} from ${JSON.stringify(real)};
      export const ${name}=${async ? 'async ' : ''}(...args)=>{const result=${async ? 'await ' : ''}original(...args);
      globalThis[Symbol.for('poc.test.request-generation-promotion')].promote(${JSON.stringify(phase)},result);return result;};` };
  }
});
try {
  const { search } = await import('../../../src/integrations/core/search.js');
  const { INTERNAL_EXACT_SEARCH_MODE } = await import('../../../src/retrieval/cli.js');
  const indexCache = createIndexCache({ maxEntries: 8, ttlMs: 0 });
  for (const phase of ['admission', 'backend', 'dictionary', 'metadata', 'signature']) {
    // LMDB deliberately has no native extracted-prose store. Exercise its two
    // supported production mode routes, including the coordinator's exact
    // prose route, rather than relaxing the public both-mode backend contract.
    for (const requestedMode of backend === 'lmdb' ? ['code', 'prose'] : ['both']) {
      fsSync.writeFileSync(pointerPath, generations.A.pointer);
      const observed = globalThis[key]; observed.phase = phase; observed.loaded = null; observed.observed = []; observed.signatures = [];
      let result;
      try { result = await search(repo, { query: 'alpha', args: ['--backend', backend, '--mode', requestedMode,
        '--import', 'A-import', '--uses', 'A-use', '--no-ann', '--json'],
      indexCache, [INTERNAL_QUERY_CACHE_BYPASS]: true,
      ...(backend === 'lmdb' && requestedMode === 'prose' ? { [INTERNAL_EXACT_SEARCH_MODE]: 'prose' } : {}) }); }
      catch (error) {
        console.log(JSON.stringify({ phase, observed: observed.observed, selected: generations.A.roots,
          lmdb: Object.fromEntries(['code', 'prose'].map(mode => {
            const paths = resolveLmdbPaths(repo, config, { indexRoot: generations.A.roots[mode] });
            const filename = mode === 'code' ? paths.codePath : paths.prosePath;
            return [mode, { filename, exists: fsSync.existsSync(path.join(filename, 'data.mdb')) }];
          })) }));
        throw error;
      }
      assert.ok(observed.observed.includes(phase), 'the requested real phase must execute');
      assert.deepEqual(result.code.map(hit => hit.name), requestedMode === 'prose' ? [] : ['A-code'], `${backend}/${phase}: code stays in admitted generation`);
      assert.deepEqual(result.prose.map(hit => hit.name), requestedMode === 'code' ? [] : ['A-prose'], `${backend}/${phase}: retained prose root stays independent`);
      for (const [mode, name] of [['code', 'idxCode'], ['prose', 'idxProse'], ['extracted-prose', 'idxExtractedProse']]) {
        if (requestedMode === 'code' && mode === 'prose' || requestedMode === 'prose' && mode !== 'prose') continue;
        const idx = observed.loaded[name];
        assert.equal(idx.indexDir, path.join(generations.A.roots[mode], `index-${mode}`));
        assert.equal(idx.chunkMeta[0].name, `A-${mode}`, 'supplemental hydration and optional comment rows stay pinned');
        idx.denseVec = null;
        attachDenseVectorLoader({ idx, mode, dir: idx.indexDir, needsAnnArtifacts: true, lazyDenseVectorsEnabled: true,
          resolvedDenseVectorMode: 'auto', strict: true });
        assert.equal((await idx.loadDenseVectors()).model, 'A', 'actual lazy ANN reads cannot follow the promoted pointer');
      }
      assert.equal(fsSync.readFileSync(pointerPath, 'utf8'), generations.B.pointer);
      for (const signature of observed.signatures) {
        for (const [mode, generation] of Object.entries(signature.generationByMode)) {
          if (!generation) continue;
          assert.equal(generation.activeBuildRoot, generations.A.roots[mode]);
          assert.equal(generation.canonicalIndexDir, path.join(generations.A.roots[mode], `index-${mode}`));
          assert.equal(generation.buildId, generations.A.ids[mode]);
        }
      }
    }
  }
  fsSync.writeFileSync(pointerPath, generations.A.pointer); globalThis[key].phase = 'admission';
  const enumeration = await search(repo, { args: ['--backend', backend, '--mode', 'code',
    '--import', 'A-import', '--uses', 'A-use', '--no-ann'], indexCache, [INTERNAL_QUERY_CACHE_BYPASS]: true });
  assert.deepEqual(enumeration.code.map(hit => hit.name), ['A-code'], 'actual filter-only admission uses the same pinned facts');

  const codeDir = path.join(generations.A.roots.code, 'index-code');
  const originalRows = JSON.parse(await fs.readFile(path.join(codeDir, 'chunk_meta.json'), 'utf8'));
  const manifestPath = path.join(codeDir, 'pieces/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.pieces.push({ name: 'file_relations', type: 'relations', format: 'json', path: 'file_relations.json' });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await fs.writeFile(path.join(codeDir, 'file_relations.json'), JSON.stringify([{ file: originalRows[0].file, relations: {} }]));
  for (const facts of [controlledFacts([], []), {}]) {
    const rows = originalRows.map(row => ({ ...row, codeRelations: facts }));
    await fs.writeFile(path.join(codeDir, 'chunk_meta.json'), JSON.stringify(rows));
    indexCache.clear();
    if (backend === 'sqlite') {
      const filename = resolveSqlitePaths(repo, config, { indexRoot: generations.A.roots.code }).codePath;
      const db = new Database(filename);
      try { db.prepare('UPDATE chunks SET codeRelations=? WHERE mode=? AND id=0').run(JSON.stringify(facts), 'code'); }
      finally { db.close(); }
    } else if (backend === 'lmdb') {
      const filename = resolveLmdbPaths(repo, config, { indexRoot: generations.A.roots.code }).codePath;
      const db = open({ path: filename, mapSize: 1024 * 1024 });
      try { db.putSync(LMDB_ARTIFACT_KEYS.chunkMeta, packr.pack(rows)); }
      finally { await closeLmdbDatabase(db, db.close); }
    }
    fsSync.writeFileSync(pointerPath, generations.A.pointer);
    const request = () => search(repo, { args: ['--backend', backend, '--mode', 'code', '--import', 'needle', '--no-ann'],
      indexCache, [INTERNAL_QUERY_CACHE_BYPASS]: true });
    if (facts.imports) assert.deepEqual((await request()).code, [], 'complete inline empty facts remain a definitive negative');
    else await assert.rejects(request(), error => error.code === 'CAPABILITY_MISSING' && error.details.field === 'imports',
      'unknown required facts cannot become an ordinary empty native/file enumeration');
  }
  const selectedManifest = path.join(generations.A.roots.code, 'index-code/pieces/manifest.json');
  const savedManifest = `${selectedManifest}.saved`;
  for (const target of [selectedManifest, savedManifest]) {
    const relative = path.relative(dir, target);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'fixture movement stays inside its disposable root');
  }
  fsSync.writeFileSync(pointerPath, generations.A.pointer); globalThis[key].phase = 'admission';
  await fs.rename(selectedManifest, savedManifest);
  try {
    await assert.rejects(search(repo, { query: 'alpha', args: ['--backend', backend, '--mode', 'code', '--no-ann'],
      indexCache, [INTERNAL_QUERY_CACHE_BYPASS]: true }), error => {
      assert.equal(error.code, 'ERR_INDEX_FORMAT_UNSUPPORTED');
      assert.equal(error.component, 'pieces manifest');
      assert.equal(error.foundVersion, 'missing');
      assert.equal(error.expectedVersion, ARTIFACT_SURFACE_VERSION);
      assert.equal(path.resolve(error.indexPath), selectedManifest, 'failure names admitted A, never promoted B');
      return true;
    });
  } finally { await fs.rename(savedManifest, selectedManifest); }
  const cancellation = AbortSignal.abort();
  await assert.rejects(search(repo, { query: 'alpha', args: ['--backend', backend], signal: cancellation }), { code: 'CANCELLED' });
} finally { hooks.deregister(); delete globalThis[key]; await fs.rm(dir, { recursive: true, force: true }); }
console.log(`Actual ${backend} request phases retain one mixed per-mode snapshot through A-to-B promotion and lazy hydration.`);
