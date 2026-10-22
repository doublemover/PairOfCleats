import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { createEmbeddingVectorSpool } from '../../../tools/build/embeddings/vector-spool.js';
import { buildEmbeddingGeneration, buildEmbeddingGenerationAsync } from '../../../src/shared/embedding-generation.js';
import { writeDenseVectorArtifacts } from '../../../src/shared/dense-vector-artifacts.js';
import { buildDenseVectorValidity } from '../../../src/shared/dense-vector-validity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('vector-spool-ordinal-generation', { clean: true });
const channels = ['code', 'doc', 'merged'], count = 43, dims = 5;
const baseline = Object.fromEntries(channels.map(channel => [channel, Array.from({ length: count }, () => new Uint8Array(0))]));
const files = [
  { name: 'z.js', ids: [35, 3, 27] },
  { name: 'a.js', ids: [0, 1, 2, 9, 10] },
  { name: 'removed-doc.js', ids: [18, 19, 20] }
];
const chunksByFile = new Map(files.map(file => [file.name, file.ids.map(index => ({ index,
  chunk: { id: `fixture-${index}`, file: file.name, start: index * 3, end: index * 3 + 2 } }))]));
const fileRows = file => Object.fromEntries(channels.map((channel, channelIndex) => [channel, file.ids.map(index => {
  const row = channel === 'doc' && index % 2 ? new Uint8Array(0)
    : Uint8Array.from({ length: dims }, (_, coordinate) => index === 0 ? 0 : (index * 7 + channelIndex * 23 + coordinate) % 256);
  baseline[channel][index] = row.slice();
  return row;
})]));
const payloads = files.map(fileRows);
const identity = { version: 'fixture', graph: 'verified-graph', tokenizer: 'verified-tokenizer', dims };
const independentDigest = vectors => {
  const hash = createHash('sha256');
  const frame = value => { const bytes = Buffer.from(stableStringify(value)); hash.update(`${bytes.length}:`); hash.update(bytes); };
  frame({ version: 1, embeddingIdentity: identity });
  for (const [file, chunks] of [...chunksByFile].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    frame(file);
    for (const entry of [...chunks].sort((left, right) => left.index - right.index)) frame(entry);
  }
  for (const channel of ['merged', 'doc', 'code']) {
    frame([channel, count]);
    for (const row of vectors[channel]) {
      if (!row.length) { frame(null); continue; }
      hash.update(`${row.length}:`); hash.update(row);
    }
  }
  return hash.digest('hex');
};
for (const order of [[2, 0, 1], [1, 2, 0]]) {
  const spool = await createEmbeddingVectorSpool({ parentDir: dir, count, dims, windowBytes: 17 });
  const owned = spool.directory;
  try {
    assert.throws(() => spool.vectors.code[0], { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
    await Promise.all(order.map(index => spool.writeFile(chunksByFile.get(files[index].name), payloads[index])));
    assert.equal(spool.stats().rowsWritten, 11);
    assert(spool.stats().durabilityBatches > 0, 'completed file ownership includes a synced durability boundary');
    await spool.seal();
    for (const channel of channels) {
      assert.equal(Array.isArray(spool.vectors[channel]), true, 'existing ordinal array consumers remain compatible');
      assert.equal(spool.vectors[channel].length, count);
      assert.deepEqual([...spool.vectors[channel]], baseline[channel]);
      assert.deepEqual(buildDenseVectorValidity(spool.vectors[channel]), buildDenseVectorValidity(baseline[channel]));
      assert.throws(() => { spool.vectors[channel][0] = Uint8Array.of(1); }, { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
      const borrowed = spool.vectors[channel][0];
      void spool.vectors[channel][35];
      assert.deepEqual(borrowed, new Uint8Array(dims), 'moving the range window never overwrites a previously returned view');
    }
    const expected = independentDigest(baseline);
    assert.equal(buildEmbeddingGeneration({ embeddingIdentity: identity, chunksByFile, vectors: baseline }), expected);
    assert.equal(await buildEmbeddingGenerationAsync({ embeddingIdentity: identity, chunksByFile, vectors: spool.vectors }), expected);
    assert.equal(await buildEmbeddingGenerationAsync({ embeddingIdentity: identity, chunksByFile, vectors: baseline }), expected);
    const artifactDir = path.join(dir, `artifacts-${order.join('')}`);
    for (const channel of channels) {
      const result = await writeDenseVectorArtifacts({ indexDir: artifactDir, baseName: `dense_${channel}`,
        vectors: spool.vectors[channel], vectorFields: { dims }, shardMaxBytes: 128, writeBinary: true });
      const bytes = await fs.readFile(result.binPath), expectedBytes = Buffer.alloc(count * dims);
      baseline[channel].forEach((row, index) => { if (row.length) expectedBytes.set(row, index * dims); });
      assert.deepEqual(bytes, expectedBytes, 'actual binary writer consumes every ordinal/channel without materializing a corpus');
      const meta = JSON.parse(await fs.readFile(result.metaPath, 'utf8'));
      assert.deepEqual(meta.validity, buildDenseVectorValidity(baseline[channel]));
      const restored = [];
      for (const part of meta.parts) {
        const records = (await fs.readFile(path.join(artifactDir, part.path), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        restored.push(...records.map(record => Uint8Array.from(record.vector)));
      }
      assert.deepEqual(restored, baseline[channel], 'actual JSONL writer retains absent channels and present zeros');
    }
    const stats = spool.stats();
    assert.equal(stats.retainedCorpusVectorBytes, 0);
    assert.equal(stats.bitmapBytes, Math.ceil(count / 8) * 5);
    assert(stats.peakReadBufferedBytes <= 3 * 15);
    assert(stats.peakWriteBufferedBytes <= 3 * 15, 'write windows are bounded by active files, not the corpus');
  } finally { await spool.close(); }
  await assert.rejects(fs.stat(owned), { code: 'ENOENT' });
}
// A cache row's ownership is borrowed through the write, then belongs to the
// spool. No transfer detaches the source or couples later caller mutation.
const copy = await createEmbeddingVectorSpool({ parentDir: dir, count: 1, dims });
try {
  const source = Uint8Array.of(1, 2, 3, 4, 5), value = { code: [source], doc: [source], merged: [source] };
  await copy.writeFile([{ index: 0 }], value); source.fill(99);
  assert.equal(source.byteLength, dims);
  await copy.seal();
  assert.deepEqual(Array.from(copy.vectors.code[0]), [1, 2, 3, 4, 5]);
} finally { await copy.close(); }
// Owner buffer growth is independent of corpus payload size. This deliberately
// asserts explicit buffer/bitmap work, not an unmeasured process RSS threshold.
for (const size of [256, 2048]) {
  const spool = await createEmbeddingVectorSpool({ parentDir: dir, count: size, dims: 4, windowBytes: 64 });
  try {
    for (let start = 0; start < size; start += 128) {
      const items = Array.from({ length: Math.min(128, size - start) }, (_, offset) => ({ index: start + offset }));
      const rows = items.map(({ index }) => Uint8Array.of(index % 256, 1, 2, 3));
      await spool.writeFile(items, { code: rows, doc: rows, merged: rows });
    }
    await spool.seal();
    for (const channel of channels) for (const row of spool.vectors[channel]) assert.equal(row.length, 4);
    const work = spool.stats();
    assert.equal(work.bitmapBytes, Math.ceil(size / 8) * 5);
    assert.equal(work.peakReadBufferedBytes, 3 * 64);
    assert(work.peakWriteBufferedBytes <= 64);
    assert.equal(work.retainedCorpusVectorBytes, 0);
  } finally { await spool.close(); }
}
console.log('ordinal vector spool generation/artifact parity assertions complete');
