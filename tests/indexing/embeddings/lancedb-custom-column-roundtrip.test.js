import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { writeLanceDbIndex } from '../../../tools/build/embeddings/lancedb.js';
import { rankLanceDb, clearLanceDbConnectionCache } from '../../../src/retrieval/lancedb.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('lancedb-custom-column-roundtrip');
const vectors = [[255, 128], [], [128, 255], [64, 255]];
for (const embeddingColumn of ['vector', 'embedding', 'features']) {
  for (const streamed of [false, true]) {
    const indexDir = path.join(dir, `${embeddingColumn}-${streamed}`); await fs.mkdir(indexDir);
    const vectorsPath = path.join(indexDir, 'vectors.json');
    if (streamed) {
      await fs.writeFile(path.join(indexDir, 'vectors.000.jsonl'), vectors.map(vector => JSON.stringify({ vector })).join('\n') + '\n');
      await fs.writeFile(path.join(indexDir, 'vectors.meta.json'), JSON.stringify({ totalRecords: 4, parts: ['vectors.000.jsonl'] }));
    }
    const result = await writeLanceDbIndex({ indexDir, variant: 'merged', ...(streamed ? { vectorsPath } : { vectors }),
      dims: 2, modelId: 'synthetic', quantization: { minVal: -1, maxVal: 1, levels: 256 }, normalize: false,
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
      const hits = await rankLanceDb({ lancedbInfo: { available: true, dir: target,
        meta: { table: 'vectors', dims: 2, metric: 'cosine', embeddingColumn, idColumn: 'document' } }, queryEmbedding: [1, 0], topN: 3 });
      assert.equal(hits.length, 3); assert.equal(hits[0].idx, 0);
    } finally { await clearLanceDbConnectionCache(); await table.close(); await db.close(); }
  }
}
console.log('custom LanceDB vector column, explicit physical schema, batches and ANN roundtrip');
