import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { resolveEmbeddingArtifactIdentity } from '../../../src/shared/embedding-artifact-identity.js';
import { buildEmbeddingGeneration } from '../../../src/shared/embedding-generation.js';
import { resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { writeHnswBackends, writeLanceDbBackends } from '../../../tools/build/embeddings/backends.js';
import { publishBackendGeneration } from '../../../tools/build/embeddings/backend-publication.js';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { loadSearchHnswIndex } from '../../../src/retrieval/index-hydration.js';
import { writeDenseVectorArtifacts, loadDenseVectorBinaryFromMetaAsync } from '../../../src/shared/dense-vector-artifacts.js';
import { updateSqliteDense } from '../../../tools/build/embeddings/sqlite-dense.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../src/storage/sqlite/index-format.js';
import Database from 'better-sqlite3';
import * as lance from '@lancedb/lancedb';
import { collectEmbeddingReplayState } from '../../../tools/service/embedding-replay.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('ann-generation-publication');
const source = path.join(root, 'source');
const indexDir = path.join(root, 'index-code');
await fs.mkdir(source, { recursive: true });
await fs.mkdir(indexDir, { recursive: true });
const warnings = [];
const warn = text => warnings.push(text);
const logger = { log() {}, warn };
const modelsDir = path.join(root, 'models');
const modelRoot = path.join(modelsDir, 'fixture/same-model');
await fs.mkdir(path.join(modelRoot, 'onnx'), { recursive: true });
await fs.writeFile(path.join(modelRoot, 'onnx/model.onnx'), 'fixture-weights-A');
await fs.writeFile(path.join(modelRoot, 'tokenizer.json'), '{"vocab":"fixture"}');
// These are byte-identity fixtures, not a claimed executable model qualification.
const modelArtifact = () => resolveEmbeddingArtifactIdentity({ modelId: 'fixture/same-model', modelsDir });
const embeddingIdentity = buildEmbeddingIdentity({ modelId: 'fixture/same-model', provider: 'transformers',
  mode: 'inline', stub: false, modelArtifact: modelArtifact(), dims: 4, normalize: true, scale: 2 / 255,
  quantization: { minVal: -1, maxVal: 1, levels: 256 } });
const vectors = Object.fromEntries(['merged', 'doc', 'code'].map(name => [name,
  [new Uint8Array([240, 140, 130, 129]), null, new Uint8Array([130, 240, 129, 140])]]));
const chunksByFile = new Map([['a.js', [{ index: 0, chunk: { chunkId: 'a' } }, { index: 2, chunk: { chunkId: 'b' } }]]]);
const embeddingGeneration = buildEmbeddingGeneration({ embeddingIdentity, vectors, chunksByFile });
const hnswConfig = { enabled: true, randomSeed: 42 };
const hnswPaths = Object.fromEntries(['merged', 'doc', 'code'].map(name => [name, resolveHnswPaths(source, name)]));
const common = { mode: 'code', modelId: embeddingIdentity.modelId, dims: 4, vectors,
  quantization: embeddingIdentity.quantization, scale: embeddingIdentity.scale, normalize: true,
  logger, log() {}, warn };
const results = {
  hnsw: await writeHnswBackends({ ...common, hnswConfig, hnswPaths, hnswIsolate: false }),
  lancedb: await writeLanceDbBackends({ ...common, indexDir: source, lanceConfig: { enabled: true, isolate: false } })
};
for (const backend of Object.values(results)) {
  for (const receipt of Object.values(backend)) {
    assert.equal(receipt.skipped, false, 'Both installed native backends must execute');
    assert.equal(receipt.count, 2, 'Null vector gaps do not inflate native counts');
  }
}
assert.deepEqual(warnings, []);
const publish = async (label, overrides = {}, prepare = async () => {}) => {
  const stageDir = path.join(root, label);
  await fs.cp(source, stageDir, { recursive: true });
  await prepare(stageDir);
  return publishBackendGeneration({ stageDir, indexDir, embeddingIdentity, embeddingGeneration,
    results, enabled: { hnsw: true, lancedb: true }, warn, ...overrides });
};
const original = await publish('original');
assert.equal(original.pieces.length, 12);
await updatePieceManifest({ indexDir, mode: 'code', totalChunks: 3, dims: 4, backendPieces: original.pieces });
const originalManifest = await fs.readFile(path.join(indexDir, 'pieces/manifest.json'));
const replay = await collectEmbeddingReplayState({ repoRoot: root, buildRoot: root, indexDir,
  mode: 'code', embeddingPayloadFormatVersion: 2 });
for (const piece of original.pieces.filter(piece => piece.format === 'json')) {
  assert.ok(replay.artifacts.presentPaths.includes(piece.path),
    'The existing replay owner must report committed native metadata at its actual generation path');
}
const originalBytes = new Map();
for (const piece of original.pieces.filter(piece => piece.format !== 'dir')) {
  originalBytes.set(piece.path, await fs.readFile(path.join(indexDir, piece.path)));
}
const metaPiece = original.pieces.find(piece => piece.name === 'dense_vectors_hnsw_meta');
const meta = JSON.parse(originalBytes.get(metaPiece.path));
if (process.platform === 'win32') assert.ok(path.join(indexDir, metaPiece.path).length > 260,
  'The real native generation fixture also covers the Windows long-path boundary');
assert.deepEqual(meta.embeddingIdentity, embeddingIdentity);
assert.equal(meta.embeddingGeneration, embeddingGeneration);
const loaded = loadSearchHnswIndex({ indexPath: path.join(indexDir,
  original.pieces.find(piece => piece.name === 'dense_vectors_hnsw').path), hnswConfig, hnswMeta: meta,
embeddingsState: { embeddingIdentity, embeddingGeneration, backends: { hnsw: original.backends.hnsw.merged } } });
assert.equal(loaded.available, true);
assert.deepEqual(loaded.index.searchKnn([1, 0, 0, 0], 2).neighbors.sort(), [0, 2]);
const lancePiece = original.pieces.find(piece => piece.name === 'dense_vectors_lancedb');
const lanceDb = await lance.connect(path.join(indexDir, lancePiece.path));
try {
  const table = await lanceDb.openTable('vectors');
  const rows = await table.query().toArray();
  assert.deepEqual(rows.map(row => row.id).sort(), [0n, 2n], 'Lance Int64 IDs and HNSW numeric IDs preserve source ordinals across null gaps');
} finally { await lanceDb.close(); }
await writeDenseVectorArtifacts({ indexDir, baseName: 'dense_vectors_uint8', vectors: vectors.merged,
  writeBinary: true, vectorFields: { dims: 4, model: embeddingIdentity.modelId, embeddingIdentity, embeddingGeneration } });
const denseMeta = JSON.parse(await fs.readFile(path.join(indexDir, 'dense_vectors_uint8.bin.meta.json')));
const dense = await loadDenseVectorBinaryFromMetaAsync({ dir: indexDir, baseName: 'dense_vectors_uint8', meta: denseMeta });
assert.equal(dense.embeddingGeneration, embeddingGeneration);
const dbPath = path.join(root, 'vectors.db');
const db = new Database(dbPath);
db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT, min_val REAL, max_val REAL, levels INTEGER)');
db.pragma(`user_version = ${SCHEMA_VERSION}`);
writeSqliteIndexFormat(db);
db.close();
const sqliteResult = updateSqliteDense({ Database, root, indexRoot: root, dbPath, mode: 'code',
  vectors: vectors.merged, dims: 4, scale: embeddingIdentity.scale, modelId: embeddingIdentity.modelId,
  quantization: embeddingIdentity.quantization, userConfig: { sqlite: { vectorExtension: { enabled: false } } },
  emitOutput: false, warnOnMissing: false, sharedDb: true });
assert.equal(sqliteResult.skipped, false);
const readDb = new Database(dbPath, { readonly: true });
try {
  const rows = readDb.prepare('SELECT doc_id, vector FROM dense_vectors WHERE mode = ? ORDER BY doc_id').all('code');
  assert.deepEqual(rows.map(row => row.doc_id), [0, 2]);
  for (const row of rows) {
    assert.deepEqual([...row.vector], [...vectors.merged[row.doc_id]]);
    assert.deepEqual([...dense.buffer.subarray(row.doc_id * 4, row.doc_id * 4 + 4)], [...row.vector]);
  }
} finally { readDb.close(); }
await fs.writeFile(path.join(modelRoot, 'onnx/model.onnx'), 'fixture-weights-B');
const changed = { ...embeddingIdentity, normalize: false, modelArtifact: modelArtifact() };
assert.notEqual(changed.modelArtifact.digest, embeddingIdentity.modelArtifact.digest);
const changedGeneration = buildEmbeddingGeneration({ embeddingIdentity: changed, chunksByFile, vectors });
for (const [label, overrides] of [
  ['failed', { results: { hnsw: {}, lancedb: {} } }],
  ['disabled', { enabled: { hnsw: false, lancedb: false } }],
  ['skipped', { results: Object.fromEntries(['hnsw', 'lancedb'].map(backend => [backend,
    Object.fromEntries(['merged', 'doc', 'code'].map(variant => [variant, { skipped: true, reason: 'fixture failure' }]))])) }],
  ['empty', { results: Object.fromEntries(['hnsw', 'lancedb'].map(backend => [backend,
    Object.fromEntries(['merged', 'doc', 'code'].map(variant => [variant, { skipped: false, count: 0 }]))])) }]
]) {
  const outcome = await publish(label, { ...overrides, embeddingIdentity: changed, embeddingGeneration: changedGeneration });
  assert.deepEqual(outcome.pieces, []);
  for (const backend of Object.values(outcome.backends)) for (const state of Object.values(backend)) assert.equal(state.available, false);
  await updatePieceManifest({ indexDir, mode: 'code', totalChunks: 3, dims: 4, backendPieces: outcome.pieces });
  const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'pieces/manifest.json')));
  assert.equal(manifest.pieces.some(piece => /hnsw|lancedb/.test(piece.name)), false, `${label}: old bytes are never recommitted as current`);
}
const partial = await publish('partial', {}, async stage => {
  await fs.rm(path.join(stage, 'dense_vectors_hnsw.bin'));
  await fs.rm(path.join(stage, 'dense_vectors_doc.lancedb.meta.json'));
});
assert.equal(partial.backends.hnsw.merged.available, false);
assert.equal(partial.backends.lancedb.doc.available, false);
assert.equal(partial.pieces.length, 8);
const replacement = await publish('replacement', { embeddingIdentity: changed, embeddingGeneration: changedGeneration });
assert.equal(replacement.pieces.length, 12);
assert.notEqual(replacement.pieces[0].path, original.pieces[0].path);
const replacementMeta = JSON.parse(await fs.readFile(path.join(indexDir,
  replacement.pieces.find(piece => piece.name === 'dense_vectors_hnsw_meta').path)));
assert.deepEqual(replacementMeta.embeddingIdentity, changed);
assert.equal(replacementMeta.embeddingGeneration, changedGeneration);
assert.equal(warnings.filter(text => text.includes('replacement unavailable')).length, 2, 'Missing pair warnings are explicitly expected');
for (const [file, bytes] of originalBytes) assert.deepEqual(await fs.readFile(path.join(indexDir, file)), bytes, 'Prior complete generation is immutable');
// An interrupted rename cannot change the previous committed manifest or files.
await fs.writeFile(path.join(indexDir, 'pieces/manifest.json'), originalManifest);
const blocked = path.join(root, 'blocked-index');
await fs.mkdir(blocked);
await fs.writeFile(path.join(blocked, '.embeddings-backends'), 'blocked');
await assert.rejects(publish('interrupted', { indexDir: blocked }), /EEXIST|ENOTDIR/);
assert.deepEqual(await fs.readFile(path.join(indexDir, 'pieces/manifest.json')), originalManifest);
console.log('Real HNSW/Lance generations preserve exact ordinals; failed, disabled, empty, partial and interrupted publication cannot admit old native bytes.');
