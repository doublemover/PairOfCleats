import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { writeLanceDbIndex } from '../../../tools/build/embeddings/lancedb.js';
import { rankLanceDb, clearLanceDbConnectionCache } from '../../../src/retrieval/lancedb.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';
const { dir } = await prepareIsolatedTestCacheDir('lancedb-custom-column-roundtrip');
const source = [[1, 0], [], [0, 1], [-.5, 1]];
for (const quantization of [{ minVal: -1, maxVal: 1, levels: 256 }, { minVal: -2, maxVal: 2, levels: 16 },
  { minVal: -.75, maxVal: .5, levels: 128 }]) for (const embeddingColumn of ['vector', 'embedding', 'features']) {
  const { minVal, maxVal, levels } = quantization;
  const vectors = source.map(row => row.map(value => Math.max(0, Math.min(levels - 1,
    Math.round((value - minVal) * (levels - 1) / (maxVal - minVal))))));
  for (const streamed of [false, true]) {
    const indexDir = path.join(dir, `${levels}-${embeddingColumn}-${streamed}`); await fs.mkdir(indexDir);
    const vectorsPath = path.join(indexDir, 'vectors.json');
    if (streamed) {
      await fs.writeFile(path.join(indexDir, 'vectors.000.jsonl'), vectors.map(vector => JSON.stringify({ vector })).join('\n') + '\n');
      await fs.writeFile(path.join(indexDir, 'vectors.meta.json'), JSON.stringify({ totalRecords: 4,
        dims: 2, model: 'synthetic', ...quantization, parts: ['vectors.000.jsonl'] }));
    }
    const result = await writeLanceDbIndex({ indexDir, variant: 'merged', ...(streamed ? { vectorsPath } : { vectors }),
      dims: 2, modelId: 'synthetic', quantization, normalize: false,
      config: { enabled: true, isolate: false, embeddingColumn, idColumn: 'document', batchSize: 2 }, emitOutput: false });
    assert.equal(result.skipped, false); assert.equal(result.count, 3);
    const target = path.join(indexDir, 'dense_vectors.lancedb');
    const db = await connect(target), table = await db.openTable('vectors');
    try {
      const schema = await table.schema();
      const vectorType = schema.fields.find(field => field.name === embeddingColumn).type;
      assert.equal(vectorType.listSize, 2); assert.equal(vectorType.children[0].type.toString(), 'Float32');
      const rows = await table.query().select(['document', embeddingColumn]).toArray();
      assert.deepEqual(rows.map(row => Number(row.document)).sort((a, b) => a - b), [0, 2, 3]);
      for (const row of rows) {
        const encoded = vectors[Number(row.document)], independent = encoded.map(value => Math.fround(minVal + value * (maxVal - minVal) / (levels - 1)));
        assert.deepEqual([...row[embeddingColumn]], independent, 'native stored floats match an independent declared-codec reference');
        assert.deepEqual([...row[embeddingColumn]], [...dequantizeUint8ToFloat32(encoded, minVal, maxVal, levels)]);
      }
      const hits = await rankLanceDb({ lancedbInfo: { available: true, dir: target,
        meta: { table: 'vectors', dims: 2, metric: 'cosine', embeddingColumn, idColumn: 'document' } }, queryEmbedding: [1, 0], topN: 3 });
      const reference = rows.map(row => ({ id: Number(row.document), score: row[embeddingColumn][0] / Math.hypot(...row[embeddingColumn]) }))
        .sort((a, b) => b.score - a.score).map(row => row.id);
      assert.deepEqual(hits.map(hit => hit.idx), reference, 'tiny native corpus agrees with exact decoded-space rankings; no ANN recall gain is implied');
    } finally { await clearLanceDbConnectionCache(); await table.close(); await db.close(); }
  }
}
console.log('custom LanceDB vector column, explicit physical schema, batches and ANN roundtrip');
