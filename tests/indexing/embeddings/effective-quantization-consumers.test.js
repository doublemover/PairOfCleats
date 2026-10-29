import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { attachEmbeddings } from '../../../src/index/build/file-processor/embeddings.js';
import { closeInlineEmbeddingBatcher } from '../../../src/shared/embedding-inline-batcher.js';
import { buildQuantizedVectors } from '../../../tools/build/embeddings/embed.js';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { iterateDenseVectorBinaryRows } from '../../../src/shared/dense-vector-stream.js';
import { encodeEmbeddingsCache, decodeEmbeddingsCache } from '../../../src/shared/embeddings-cache/format.js';
import { resolveEmbeddingQuantizationSpec } from '../../../src/shared/embedding-quantization-spec.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveVectorsSource } from '../../../tools/build/embeddings/vector-source.js';
import { loadDenseVectorBinaryFromMetaAsync } from '../../../src/shared/dense-vector-binary.js';
import { materializeDenseVectorRows } from '../../../src/shared/dense-vector-meta.js';
import { quantizeEmbeddingVectorUint8 } from '../../../src/shared/embedding-quantization.js';
import { postprocessEmbeddingChannels } from '../../../src/shared/embedding-postprocess.js';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';

for (const quantization of [{}, { minVal: -2, maxVal: 2, levels: 16 }, { minVal: -.75, maxVal: .5, levels: 128 }]) {
  const spec = resolveEmbeddingQuantizationSpec(quantization);
  assert.ok(Object.isFrozen(spec)); assert.equal(resolveEmbeddingQuantizationSpec(spec), spec);
  for (const normalize of [true, false]) for (const Type of [Array, Float32Array, Float64Array]) {
    for (const channels of ['code', 'doc', 'both']) {
      const source = Type.from([.5, -.5]), before = Array.from(source);
      const codeVector = ['code', 'both'].includes(channels) ? source : [];
      const docVector = ['doc', 'both'].includes(channels) ? source : [];
      const provider = async texts => texts.map(text => text === 'code' ? codeVector : docVector);
      const chunks = [{}];
      if (channels === 'doc') {
        // Provider admission requires nonempty submitted code rows. The shared
        // inline postprocessor owns the supported absent-code channel boundary.
        const actual = postprocessEmbeddingChannels({ codeVector, docVector, normalize, quantization: spec });
        Object.assign(chunks[0], { embedding_u8: actual.quantizedMerged, embed_code_u8: actual.quantizedCode, embed_doc_u8: actual.quantizedDoc });
      } else try {
        await attachEmbeddings({ chunks, codeTexts: ['code'], docTexts: [channels === 'both' ? 'doc' : ''], embeddingEnabled: true,
          embeddingNormalize: normalize, quantization: spec, getChunkEmbeddings: provider, embeddingBatchSize: 1 });
      } finally { await closeInlineEmbeddingBatcher(provider); }
      const expected = buildQuantizedVectors({ codeVector, docVector, normalize, quantization: spec });
      for (const [field, output] of [['embedding_u8', 'quantizedMerged'], ['embed_code_u8', 'quantizedCode'], ['embed_doc_u8', 'quantizedDoc']]) {
        assert.deepEqual(chunks[0][field], expected[output], `${channels}/${normalize}/${Type.name}/${field}`);
        const reference = field === 'embed_code_u8' ? codeVector : field === 'embed_doc_u8' ? docVector : source;
        const norm = normalize ? Math.hypot(...reference.map(Math.fround)) : 1;
        const independent = [...reference].map(value => {
          const scalar = normalize ? Math.fround(Math.fround(value) / norm) : value;
          return Math.min(spec.levels - 1, Math.max(0, Math.round((scalar - spec.minVal) * (spec.levels - 1) / (spec.maxVal - spec.minVal))));
        });
        assert.deepEqual([...chunks[0][field]], independent, 'reference scalar formula does not call the producer encoder');
      }
      assert.deepEqual(Array.from(source), before);
    }
  }
}
const { dir } = await prepareIsolatedTestCacheDir('effective-quantization-consumers');
const spec = resolveEmbeddingQuantizationSpec({ minVal: -2, maxVal: 2, levels: 16 });
const vectors = [Uint8Array.of(9, 6), new Uint8Array(0)];
const identity = { dims: 2, quantization: spec };
const oldIdentity = buildEmbeddingIdentity({ modelId: 'codec-fixture', provider: 'stub', dims: 2,
  quantization: { ...spec, version: 1 } });
const currentIdentity = buildEmbeddingIdentity({ modelId: 'codec-fixture', provider: 'stub', dims: 2, quantization: spec });
assert.notEqual(buildEmbeddingIdentityKey(oldIdentity), buildEmbeddingIdentityKey(currentIdentity), 'codec v2 prevents poisoned v1 reuse');
let workerCalls = 0;
const worker = { runQuantize: async payload => {
  workerCalls++; assert.deepEqual(payload.quantization, spec);
  throw new Error('ordinary worker failure requires the same effective inline codec');
} };
const fallback = await buildDenseVectors({ chunks: [{ embedding: [.5, -.5], embed_doc: [0, 0], embed_code: [.5, -.5] }],
  embeddingsEnabled: true, modelId: 'codec-fixture', workerPool: worker, quantization: spec });
assert.ok(workerCalls > 0); assert.deepEqual([...fallback.quantizedVectors[0]], [9, 6]);
assert.deepEqual([...fallback.quantizedDocVectors[0]], [8, 8]);
await writeDenseVectorArtifacts({ indexDir: dir, baseName: 'dense_vectors_uint8', vectors, writeBinary: true,
  vectorFields: { dims: 2, embeddingIdentity: identity, minVal: spec.minVal, maxVal: spec.maxVal, levels: spec.levels, scale: spec.scale } });
const meta = JSON.parse(await fs.readFile(path.join(dir, 'dense_vectors_uint8.bin.meta.json'), 'utf8'));
assert.equal(meta.quantizationVersion, spec.version); assert.equal(meta.scale, spec.scale);
assert.equal(meta.validity.validCount, 1);
const oldMetaPath = path.join(dir, 'dense_vectors_uint8.meta.json'), oldMetaBytes = await fs.readFile(oldMetaPath);
const oldMeta = JSON.parse(oldMetaBytes); const fields = oldMeta.fields || oldMeta;
fields.embeddingIdentity = { ...identity, quantization: { ...spec, version: 1 } };
await fs.writeFile(oldMetaPath, JSON.stringify(oldMeta));
assert.throws(() => resolveVectorsSource(path.join(dir, 'dense_vectors_uint8.json'), { preferBinary: false, expectedEmbeddingIdentity: identity }),
  { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' });
await fs.writeFile(oldMetaPath, oldMetaBytes);
const rows = [];
for await (const row of iterateDenseVectorBinaryRows({ root: dir, filename: path.join(dir, meta.path), meta })) rows.push([...row.vector]);
assert.deepEqual(rows, [[9, 6], []]);
const direct = await loadDenseVectorBinaryFromMetaAsync({ dir, baseName: 'dense_vectors_uint8', meta });
assert.deepEqual(materializeDenseVectorRows(direct).map(row => [...row]), rows);
const textual = resolveVectorsSource(path.join(dir, 'dense_vectors_uint8.json'), { preferBinary: false, expectedDims: 2, expectedQuantization: spec });
const textualRows = [];
for await (const row of textual.rows) textualRows.push([...row.vector]);
assert.deepEqual(textualRows, rows);
assert.throws(() => resolveVectorsSource(path.join(dir, 'dense_vectors_uint8.json'), {
  preferBinary: false, expectedQuantization: { ...spec, levels: 128 } }), /source codec disagrees/);
assert.throws(() => materializeDenseVectorRows({ ...meta, quantizationVersion: 999, vectors }), /Unsupported dense quantization codec/);
const payload = { cacheMeta: { identity, identityKey: 'fixture' }, codeVectors: vectors, docVectors: [[], []], mergedVectors: vectors };
const cached = await decodeEmbeddingsCache(await encodeEmbeddingsCache(payload));
assert.deepEqual(cached.mergedVectors.map(row => [...row]), [[9, 6], []]);
await assert.rejects(encodeEmbeddingsCache({ ...payload, codeVectors: [[16, 1], []] }), /Invalid quantized value/);
await assert.rejects(encodeEmbeddingsCache({ ...payload, codeVectors: [[1.5, 1], []] }), /Invalid quantized value/);
await assert.rejects(writeDenseVectorArtifacts({ indexDir: dir, baseName: 'bad', vectors: [[16, 1]],
  vectorFields: { dims: 2, embeddingIdentity: identity, minVal: -2, maxVal: 2, levels: 16 } }), /Invalid quantized value/);
await fs.writeFile(path.join(dir, meta.path), Uint8Array.of(16, 1, spec.paddingValue, spec.paddingValue));
assert.equal(await loadDenseVectorBinaryFromMetaAsync({ dir, baseName: 'dense_vectors_uint8', meta }), null);
assert.throws(() => materializeDenseVectorRows({ ...meta, vectors: [[16, 1], []] }), /Invalid quantized value/);
await assert.rejects(async () => { for await (const row of iterateDenseVectorBinaryRows({ root: dir, filename: path.join(dir, meta.path), meta })) void row; }, /Invalid quantized value/);
for (const quantization of [{ minVal: 1, maxVal: 1 }, { minVal: 2, maxVal: -2 }, { levels: Infinity }, { minVal: NaN }]) {
  assert.throws(() => resolveEmbeddingQuantizationSpec(quantization), /Quantization/);
}
for (const levels of [2, 16, 128, 256]) {
  const actual = quantizeEmbeddingVectorUint8([-3, -2, -1, 0, 1, 2, 3], -2, 2, levels);
  assert.deepEqual([...actual], [0, 0, Math.round((levels - 1) / 4), Math.round((levels - 1) / 2),
    Math.round(3 * (levels - 1) / 4), levels - 1, levels - 1]);
}
console.log('Inline/deferred bytes, dense metadata, binary streaming and cache admission share one immutable effective codec.');
