import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { open } from 'lmdb';
import { Packr } from 'msgpackr';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { captureValidationSelection } from '../../../src/index/validate/selection.js';
import { captureSelectedModeRoots } from '../../../src/shared/indexing/selected-mode-roots.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { META_V2_SCHEMA_VERSION } from '../../../src/index/metadata/meta-v2.js';
import { initBuildState, recordOrderingHash } from '../../../src/index/build/build-state.js';
import { hashDeterministicIterable } from '../../../src/shared/invariants.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { closeLmdbDatabase } from '../../../src/storage/lmdb/close.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('operation-generation-selection/')[1];
assert.ok(['captured-move', 'during-read', 'mixed-roots', 'strict-ledger', 'capture-authority', 'legacy-move', 'invalid-selection'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`validation-generation-${selected}`);
const root = path.join(dir, 'repo'); await fs.mkdir(root);
const userConfig = { ...defaultUserConfig, cache: { root: path.join(dir, 'cache') }, sqlite: { use: true }, lmdb: { use: true } };
const repoCache = resolveRepoCacheRootPath(root, userConfig), builds = path.join(repoCache, 'builds');
const roots = { A: path.join(builds, 'A'), B: path.join(builds, 'B') }, packr = new Packr();
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
for (const [generation, generationRoot] of Object.entries(roots)) {
  await fs.mkdir(generationRoot, { recursive: true });
  await initBuildState({ buildRoot: generationRoot, buildId: generation, repoRoot: root, modes: ['code', 'prose'],
    stage: 'stage2', configHash: 'fixture', toolVersion: 'test', repoProvenance: {}, signatureVersion: 2 });
  for (const mode of ['code', 'prose']) {
    const seeded = await createBaseIndex({ rootDir: path.join(dir, `${generation}-${mode}`),
      manifestOverrides: { mode, buildId: generation }, indexState: { mode, buildId: generation,
        artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, stage: 'stage2', generatedAt: new Date().toISOString() },
      chunkMeta: [{ id: 0, file: `${generation}-${mode}.js`, start: 0, end: 1,
        metaV2: { schemaVersion: META_V2_SCHEMA_VERSION, file: `${generation}-${mode}.js` } }] });
    const indexDir = path.join(generationRoot, `index-${mode}`);
    await fs.cp(seeded.indexDir, indexDir, { recursive: true });
    const chunks = JSON.parse(await fs.readFile(path.join(indexDir, 'chunk_meta.json'), 'utf8'));
    const ordering = hashDeterministicIterable(chunks, { encodeLine: row => JSON.stringify(row) });
    await recordOrderingHash(generationRoot, { stage: 'stage2', mode, artifact: 'chunk_meta',
      hash: ordering.hash, rule: 'chunk_meta:compareChunkMetaRows', count: ordering.count });
    await fs.mkdir(path.join(generationRoot, 'index-sqlite'), { recursive: true });
    const sqlite = new Database(path.join(generationRoot, 'index-sqlite', `index-${mode}.db`));
    try {
      sqlite.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(sqlite); sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
      sqlite.prepare('INSERT INTO chunks (id, chunk_id, mode, file, metaV2_json) VALUES (?, ?, ?, ?, ?)')
        .run(chunks[0].id, chunks[0].chunkId, mode, chunks[0].file, JSON.stringify(chunks[0].metaV2));
    } finally { sqlite.close(); }
    const lmdb = open({ path: path.join(generationRoot, 'index-lmdb', `index-${mode}`), mapSize: 1024 * 1024 });
    try {
      for (const [key, value] of [[LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION], [LMDB_META_KEYS.mode, mode],
        [LMDB_META_KEYS.chunkCount, chunks.length], [LMDB_META_KEYS.mapSizeBytes, 1024 * 1024],
        [LMDB_META_KEYS.mapSizeEstimatedBytes, 1024], [LMDB_META_KEYS.artifacts, [LMDB_ARTIFACT_KEYS.chunkMeta, LMDB_ARTIFACT_KEYS.tokenPostings]],
        [LMDB_ARTIFACT_KEYS.chunkMeta, chunks], [LMDB_ARTIFACT_KEYS.tokenPostings, { vocab: ['alpha'], postings: [[[0, 1]]] }]]) {
        lmdb.putSync(key, packr.pack(value));
      }
    } finally { await closeLmdbDatabase(lmdb, lmdb.close); }
  }
}
const current = path.join(builds, 'current.json');
const pointer = (code, prose) => ({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: code,
  buildRoot: path.relative(repoCache, roots[code]), buildRootsByMode: {
    code: path.relative(repoCache, roots[code]), prose: path.relative(repoCache, roots[prose]) }, modes: ['code', 'prose'], promotedAt: new Date().toISOString() });
const publish = (code, prose = code) => fsSync.writeFileSync(current, JSON.stringify(pointer(code, prose)));
publish('A', selected === 'mixed-roots' ? 'B' : 'A');
const beforeHash = createHash('sha256').update(await fs.readFile(current)).digest('hex');
const input = { root, userConfig, modes: ['code', 'prose'], strict: true, sqliteEnabled: true, lmdbEnabled: true, validateOrdering: true };
let report;
if (selected === 'invalid-selection') {
  await fs.writeFile(current, '{broken');
  report = await validateIndexArtifacts(input);
  assert.equal(report.ok, false);
  assert.equal(report.selection, null);
  assert.equal(report.sqlite.ok, false); assert.equal(report.lmdb.ok, false);
  for (const mode of input.modes) {
    assert.equal(report.modes[mode].ok, false);
    assert.equal(report.modes[mode].path, null);
    assert.equal(report.sqlite[mode], null); assert.equal(report.lmdb[mode], null);
  }
  assert.ok(report.findings.some(row => row.code === 'ERR_INDEX_SELECTION_UNAVAILABLE'));
} else if (selected === 'legacy-move') {
  for (const entry of await fs.readdir(roots.A)) {
    await fs.cp(path.join(roots.A, entry), path.join(repoCache, entry), { recursive: true });
  }
  await fs.unlink(current);
  const selection = captureValidationSelection(input);
  assert.equal(selection.source, 'no-publication');
  publish('B');
  report = await validateIndexArtifacts({ ...input, selection });
} else if (selected === 'captured-move' || selected === 'capture-authority') {
  const capturedModes = captureSelectedModeRoots({ root, userConfig });
  if (selected === 'capture-authority') {
    capturedModes.roots.code = roots.B;
    capturedModes.pointer.buildRootsByMode.code = path.relative(repoCache, roots.B);
  }
  const selection = captureValidationSelection({ ...input, capturedModes });
  if (selected === 'capture-authority') {
    await assert.rejects(validateIndexArtifacts({ ...input, selection: { ...selection } }), /original operation-owned/);
    await assert.rejects(validateIndexArtifacts({ ...input, userConfig: { ...userConfig }, selection }), /original operation-owned/);
  }
  publish('B');
  report = await validateIndexArtifacts({ ...input, selection });
} else if (selected === 'during-read') {
  let moved = false;
  const readMetrics = {};
  Object.defineProperty(readMetrics, 'code', { get() { if (!moved) { moved = true; publish('B'); } return {}; } });
  report = await validateIndexArtifacts({ ...input, readMetrics });
  assert.equal(moved, true, 'publication advances at an actual per-mode validation boundary');
} else if (selected === 'strict-ledger') {
  await fs.unlink(path.join(roots.A, 'build_state.json'));
  report = await validateIndexArtifacts(input);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(row => row.code === 'ERR_INDEX_ORDERING_LEDGER_MISSING'));
} else report = await validateIndexArtifacts(input);
if (!['strict-ledger', 'invalid-selection'].includes(selected)) {
  assert.equal(report.ok, true, JSON.stringify(report.issues));
  assert.equal(report.orderingDrift.length, 0, 'each mode uses its selected generation ledger');
  // These minimal indexes deliberately omit optional families. Assert every
  // expected warning so an unrelated backend or authority warning cannot pass.
  const optional = ['minhash_signatures', 'file_relations', 'call_sites', 'symbols', 'symbol_occurrences', 'symbol_edges',
    'graph_relations', 'risk_summaries', 'risk_flows', 'risk_partial_flows', 'risk_interprocedural_stats', 'chunk_uid_map',
    'vfs_manifest', 'repo_map', 'filter_index', 'field_postings', 'field_tokens', 'vocab_order',
    'dense_vectors_lancedb_meta', 'dense_vectors_doc_lancedb_meta', 'dense_vectors_code_lancedb_meta'];
  assert.deepEqual(report.warnings, ['code', 'prose'].flatMap(mode => optional
    .filter(name => mode === 'code' || !['symbols', 'symbol_occurrences', 'symbol_edges'].includes(name))
    .map(name => `[${mode}] optional ${name} missing`)));
}
if (selected === 'legacy-move') assert.equal(report.selection.pointerReceipt, null);
else if (selected !== 'invalid-selection') assert.equal(report.selection.pointerReceipt.sha256, beforeHash);
for (const mode of selected === 'invalid-selection' ? [] : ['code', 'prose']) {
  const expected = selected === 'legacy-move' ? repoCache : selected === 'mixed-roots' && mode === 'prose' ? roots.B : roots.A;
  assert.equal(normalized(report.modes[mode].path), normalized(path.join(expected, `index-${mode}`)));
  assert.equal(normalized(report.sqlite[mode]), normalized(path.join(expected, 'index-sqlite', `index-${mode}.db`)));
  assert.equal(normalized(report.lmdb[mode]), normalized(path.join(expected, 'index-lmdb', `index-${mode}`)));
}
console.log(`Validation ${selected} keeps original per-mode artifacts, native backends, pointer bytes and ordering evidence.`);
