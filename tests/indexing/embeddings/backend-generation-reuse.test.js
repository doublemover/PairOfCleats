#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildEmbeddingIdentity } from '../../../src/shared/embedding-identity.js';
import { normalizeHnswConfig, resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { normalizeLanceDbConfig, resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { buildNativeBackendReuseKey } from '../../../tools/build/embeddings/backend-reuse-key.js';
import { inventoryBackendPayload } from '../../../tools/build/embeddings/backend-payload-copy.js';
import { reuseNativeBackend } from '../../../tools/build/embeddings/backend-reuse.js';
import { writeHnswBackends, writeLanceDbBackends } from '../../../tools/build/embeddings/backends.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const root = await prepareArtifactIoTestDir('backend-generation-reuse');
const generation = '4'.repeat(64), relativeDir = `.embeddings-backends/${generation}-00000000-0000-4000-8000-000000000001`;
const priorDir = path.join(root, relativeDir), stageDir = path.join(root, 'attempt');
const embeddingIdentity = buildEmbeddingIdentity({ stub: true, provider: 'stub', dims: 2, modelId: 'fixture' });
const common = { dims: 2, modelId: 'fixture', quantization: { minVal: -1, maxVal: 1, levels: 256 }, scale: 1, normalize: true };
const priorState = { ready: true, pending: false, embeddingGeneration: generation, embeddingIdentity };
const configs = { hnsw: normalizeHnswConfig({ enabled: true }), lancedb: normalizeLanceDbConfig({ enabled: true, isolate: true }) };
const checksum = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
try {
  await fs.mkdir(priorDir, { recursive: true }); await fs.mkdir(stageDir);
  const pieces = [];
  for (const backend of ['hnsw', 'lancedb']) for (const variant of ['merged', 'doc', 'code']) {
    const paths = backend === 'hnsw' ? resolveHnswPaths(priorDir, variant) : resolveLanceDbPaths(priorDir)[variant];
    const data = paths.indexPath || paths.dir;
    let inventory = null;
    if (backend === 'hnsw') await fs.writeFile(data, `synthetic-native-graph-${variant}`);
    else {
      await fs.mkdir(path.join(data, 'vectors.lance', '_versions'), { recursive: true });
      await fs.mkdir(path.join(data, 'vectors.lance', 'data'));
      await fs.writeFile(path.join(data, 'vectors.lance', '_versions', '1.manifest'), `synthetic-version-${variant}`);
      await fs.writeFile(path.join(data, 'vectors.lance', 'data', '1.lance'), `synthetic-fragment-${variant}`);
      inventory = await inventoryBackendPayload({ dir: data });
    }
    const key = buildNativeBackendReuseKey({ backend, config: configs[backend], ...common });
    assert.equal(typeof key, 'string', 'prepared dependency package identity is required; no native import is performed');
    const meta = { model: 'fixture', dims: 2, count: 2, table: 'vectors', embeddingIdentity,
      embeddingGeneration: generation, backendGeneration: relativeDir, variant,
      extensions: { nativeBuildKey: key, ...(inventory ? { nativePayloadInventory: inventory } : {}) } };
    await fs.writeFile(paths.metaPath, JSON.stringify(meta));
    const prefix = variant === 'merged' ? 'dense_vectors' : `dense_vectors_${variant}`, name = `${prefix}_${backend}`;
    const metaBytes = await fs.readFile(paths.metaPath);
    pieces.push({ name: `${name}_meta`, path: `${relativeDir}/${path.basename(paths.metaPath)}`, format: 'json',
      count: 2, dims: 2, bytes: metaBytes.length, checksum: checksum(metaBytes) });
    const dataBytes = backend === 'hnsw' ? await fs.readFile(data) : null;
    pieces.push({ name, path: `${relativeDir}/${path.basename(data)}`, format: backend === 'hnsw' ? 'bin' : 'dir', count: 2, dims: 2,
      ...(dataBytes ? { bytes: dataBytes.length, checksum: checksum(dataBytes) } : {}) });
  }
  await writePiecesManifest(root, pieces);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'pieces', 'manifest.json')));
  const reuse = ({ backend, variant, config }) => reuseNativeBackend({ backend, variant, config, indexDir: root, stageDir,
    priorManifest: manifest, priorState, embeddingIdentity, embeddingGeneration: generation, ...common });
  const hnsw = await writeHnswBackends({ mode: 'code', hnswConfig: configs.hnsw, hnswIsolate: true,
    hnswPaths: Object.fromEntries(['merged', 'doc', 'code'].map(variant => [variant, resolveHnswPaths(stageDir, variant)])),
    reuse, ...common, warn: message => assert.fail(message), log: () => {} });
  assert.equal(hnsw.work.childStarts, 0);
  assert.equal(hnsw.work.reusedVariants, 3);
  assert.ok(Object.values(hnsw).every(result => result.reused));
  const lance = await writeLanceDbBackends({ mode: 'code', indexDir: stageDir, lanceConfig: configs.lancedb,
    reuse, ...common, warn: message => assert.fail(message) });
  assert.equal(lance.work.childStarts, 0);
  assert.equal(lance.work.reusedVariants, 3);
  assert.deepEqual(await fs.readFile(resolveHnswPaths(stageDir).indexPath), await fs.readFile(resolveHnswPaths(priorDir).indexPath));
  const originalFragment = path.join(resolveLanceDbPaths(priorDir).merged.dir, 'vectors.lance', 'data', '1.lance');
  const copiedFragment = path.join(resolveLanceDbPaths(stageDir).merged.dir, 'vectors.lance', 'data', '1.lance');
  assert.deepEqual(await fs.readFile(copiedFragment), await fs.readFile(originalFragment));
  await fs.writeFile(copiedFragment, 'private-change');
  assert.match((await fs.readFile(originalFragment)).toString(), /synthetic-fragment/, 'the copied generation shares no mutable payload file');

  const candidate = { backend: 'hnsw', variant: 'merged', config: configs.hnsw, indexDir: root,
    stageDir: path.join(root, 'refused'), priorManifest: manifest, priorState, embeddingIdentity, embeddingGeneration: generation, ...common };
  const configChange = await reuseNativeBackend({ ...candidate, config: { ...configs.hnsw, m: 24 } });
  assert.equal(configChange.reused, false);
  assert.equal(configChange.reason, 'changed-native-build-proof');
  assert.equal((await reuseNativeBackend({ ...candidate, embeddingGeneration: '5'.repeat(64) })).reused, false);
  assert.equal((await reuseNativeBackend({ ...candidate, priorState: { ...priorState, pending: true } })).reused, false);
  await fs.writeFile(resolveHnswPaths(priorDir).indexPath, 'tampered-graph');
  const corrupt = await reuseNativeBackend(candidate);
  assert.equal(corrupt.reused, false);
  await assert.rejects(fs.stat(resolveHnswPaths(candidate.stageDir).indexPath), { code: 'ENOENT' });
  await fs.mkdir(path.join(resolveLanceDbPaths(priorDir).doc.dir, 'unexpected-empty-directory'));
  assert.equal((await reuseNativeBackend({ ...candidate, backend: 'lancedb', variant: 'doc', config: configs.lancedb })).reused, false,
    'payload inventory binds added directories and files, including empty ones');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reuseNativeBackend({ ...candidate, signal: controller.signal }), { name: 'AbortError' });
  console.log('Unchanged native generations require complete binding/config/checksum proofs and copy into independent staging; synthetic payloads, no native decoding.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
