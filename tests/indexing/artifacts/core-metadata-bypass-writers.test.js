#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createArtifactWriter } from '../../../src/index/build/artifacts/writer.js';
import { enqueueTokenPostingsArtifacts } from '../../../src/index/build/artifacts/token-postings.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from '../../../src/index/build/artifacts/repo-map.js';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { classifyGeneratedArtifactCorePrefix } from '../../../src/shared/generated-artifact-core.js';
import { validateArtifact } from '../../../src/contracts/artifact-schemas.js';
import { buildRelationBenchChunks, writeRelationBenchGraphArtifacts } from '../../../tools/bench/index/relations-fixture.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'core-metadata-bypass-writers');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const queue = [];
const hooks = {
  enqueueWrite: (_label, job) => queue.push(job),
  addPieceFile: () => {},
  formatArtifactLabel: (value) => value,
  log: () => {},
  removeArtifact: (target) => fs.rm(target, { recursive: true, force: true })
};
const flush = async () => { for (const job of queue.splice(0)) await job(); };
const inspect = async (name, kind, schema = null) => {
  const text = await fs.readFile(path.join(root, name), 'utf8');
  const meta = JSON.parse(text);
  assert.equal(Object.keys(meta)[0], 'extensions');
  assert.equal(classifyGeneratedArtifactCorePrefix({ prefix: text, relativePath: name })?.kind, kind);
  if (schema) {
    const validated = validateArtifact(schema, meta);
    assert.ok(validated.ok, validated.errors.join('; '));
  }
  return meta;
};

try {
  const writer = createArtifactWriter({ outDir: root, ...hooks, compressionEnabled: false });
  const rows = [{ id: 0, file: 'a.js' }, { id: 1, file: 'b.js' }];
  writer.enqueueJsonArraySharded('file_meta', rows, {
    maxBytes: 32, estimatedBytes: 100, compression: 'gzip',
    metaExtensions: { fingerprint: 'caller-fingerprint', __poc_generated: { stale: true } }
  });
  // The generic data writer must remain policy-neutral, including same-name data.
  writer.enqueueJsonObject('authored', { fields: { value: 1 } });
  await flush();
  const fileMeta = await inspect('file_meta.meta.json', 'sharded-meta', 'file_meta_meta');
  assert.equal(fileMeta.extensions.fingerprint, 'caller-fingerprint');
  const decoded = [];
  for (const part of fileMeta.parts) {
    const bytes = await fs.readFile(path.join(root, part.path));
    assert.equal(bytes[0], 0x1f, 'gzip framing must remain intact');
    const text = gunzipSync(bytes).toString('utf8');
    decoded.push(...text.trim().split('\n').map(JSON.parse));
  }
  assert.deepEqual(decoded, rows);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'authored.json'), 'utf8')), { value: 1 });

  await enqueueTokenPostingsArtifacts({
    outDir: root, ...hooks, enqueueJsonObject: writer.enqueueJsonObject,
    postings: { tokenVocab: ['alpha', 'beta'], tokenVocabIds: [100, 200], tokenPostingsList: [[[0, 1]], [[1, 1]]], avgDocLen: 1 },
    state: { docLengths: [1, 1] }, tokenPostingsFormat: 'json', tokenPostingsUseShards: true,
    tokenPostingsShardSize: 1, tokenPostingsCompression: null
  });
  await flush();
  const tokenMeta = await inspect('token_postings.meta.json', 'token-postings-meta', 'token_postings_meta');
  assert.ok(tokenMeta.extensions.tokenId);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, tokenMeta.parts[0]), 'utf8')).vocabIds, [100]);

  const mapRows = [{ file: 'a.js', name: 'a', kind: 'function', signature: 'a()', startLine: 1, endLine: 1 }];
  const repoMapIterator = () => mapRows;
  const fileIdByPath = new Map([['a.js', 0]]);
  await enqueueRepoMapArtifacts({
    outDir: root, ...hooks, repoMapIterator, fileIdByPath, maxJsonBytes: 1024,
    repoMapMeasurement: measureRepoMap({ repoMapIterator, fileIdByPath, maxJsonBytes: 1024 }),
    useRepoMapJsonl: true, repoMapCompression: null
  });
  await flush();
  const repoMeta = await inspect('repo_map.meta.json', 'sharded-meta', 'repo_map_meta');
  assert.equal(repoMeta.extensions.delta.tables.signature[1], 'a()');

  await writeRelationBenchGraphArtifacts({
    outDir: root, chunks: buildRelationBenchChunks({ chunkCount: 3, edgesPerChunk: 1 }),
    fileRelations: new Map(), maxJsonBytes: 4096
  });
  const graphMeta = await inspect('graph_relations.meta.json', 'sharded-meta', 'graph_relations_meta');
  assert.ok(graphMeta.extensions.graphs);
  assert.ok(graphMeta.extensions.offsets);

  await writeDenseVectorArtifacts({
    indexDir: root, baseName: 'dense_vectors_uint8', vectors: [[1, 2], [3, 4]], writeBinary: true,
    vectorFields: { dims: 2, model: 'fixture', extensions: { quantization: 'retained', __poc_generated: { stale: true } } }
  });
  const denseMeta = await inspect('dense_vectors_uint8.meta.json', 'dense-vector-meta');
  assert.equal(denseMeta.dims, 2);
  assert.equal(denseMeta.extensions.quantization, 'retained');
  assert.deepEqual(await fs.readFile(path.join(root, 'dense_vectors_uint8.bin')), Buffer.from([1, 2, 3, 4]));
  const vectorRows = [];
  for (const part of denseMeta.parts) {
    vectorRows.push(...(await fs.readFile(path.join(root, part.path), 'utf8')).trim().split('\n').map(JSON.parse));
  }
  assert.deepEqual(vectorRows, [{ vector: [1, 2] }, { vector: [3, 4] }]);
  console.log('core metadata bypass producers preserve schemas and native data bytes');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
