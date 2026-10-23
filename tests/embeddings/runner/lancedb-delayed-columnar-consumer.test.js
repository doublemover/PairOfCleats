import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { dequantizeUint8ToFloat32 } from '../../../src/storage/sqlite/vector.js';

// Actual staged writer/Arrow batches, inert delayed native boundary. Authored
// only; successful delayed consumption does not qualify rejected native work.
const key = Symbol.for('poc.tests.lancedb-delayed-columnar');
// Replace only the native connection import; Arrow resolves the real consumer package.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@lancedb/lancedb'
      && context.parentURL?.endsWith('/src/shared/optional-deps.js') ? { url: 'poc:lancedb-delayed-columnar', shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === 'poc:lancedb-delayed-columnar' ? { format: 'module', shortCircuit: true,
      source: `export const connect = dir => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](dir);` } : next(url, context);
  }
});
const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-delayed-columnar-consumer');
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const originalVectors = [[255, 128], [], [128, 255], [64, 255]];
try {
  const { writeLanceDbIndex } = await import('../../../tools/build/embeddings/lancedb.js');
  for (const streamed of [false, true]) {
    const indexDir = path.join(root, streamed ? 'stream' : 'array'); await fs.mkdir(indexDir);
    const vectors = originalVectors.map(row => [...row]), vectorsPath = path.join(indexDir, 'vectors.json');
    if (streamed) {
      await fs.writeFile(path.join(indexDir, 'vectors.000.jsonl'), vectors.map(vector => JSON.stringify({ vector })).join('\n') + '\n');
      await fs.writeFile(path.join(indexDir, 'vectors.meta.json'), JSON.stringify({ totalRecords: 4, parts: ['vectors.000.jsonl'] }));
    }
    const createStarted = gate(), createComplete = gate(), addStarted = gate(), addComplete = gate();
    const records = []; let active = 0, tableCloses = 0, dbCloses = 0, firstSchema;
    const rows = batch => Array.from({ length: batch.numRows }, (_, index) => ({
      id: Number(batch.getChild('document').get(index)), vector: [...batch.getChild('features').get(index)]
    }));
    const consume = async (batch, started, complete) => {
      assert.equal(active++, 0, 'actual writer submits one batch at a time');
      const before = rows(batch); started.resolve(before);
      await complete.promise;
      assert.deepEqual(rows(batch), before, 'ID/vector backing stores stay unchanged until the actual consumer finishes');
      records.push(...before); active--;
    };
    globalThis[key] = async target => ({
      async createTable(name, batch) {
        firstSchema = batch.schema;
        await consume(batch, createStarted, createComplete);
        const dataset = path.join(target, `${name}.lance`);
        await fs.mkdir(path.join(dataset, '_versions'), { recursive: true }); await fs.mkdir(path.join(dataset, 'data'));
        await fs.writeFile(path.join(dataset, '_versions/1.manifest'), 'inert manifest');
        await fs.writeFile(path.join(dataset, 'data/1.lance'), 'inert fragment');
        return { add: batch => consume(batch, addStarted, addComplete), schema: async () => firstSchema,
          countRows: async () => records.length, close: async () => { tableCloses++; } };
      },
      close: async () => { dbCloses++; }
    });
    const writing = writeLanceDbIndex({ indexDir, variant: 'merged', ...(streamed ? { vectorsPath } : { vectors }),
      dims: 2, modelId: 'explicit-fixture', quantization: { minVal: -1, maxVal: 1, levels: 256 }, normalize: false,
      config: { enabled: true, isolate: false, idColumn: 'document', embeddingColumn: 'features', batchSize: 2 },
      emitOutput: false, logger: { log() {}, warn(message) { assert.fail(message); } } });
    writing.catch(() => {});
    const untilStarted = started => Promise.race([started.promise, writing.then(() => {
      throw new Error('Writer completed before its expected controlled consumption boundary.');
    })]);
    try {
      assert.deepEqual((await untilStarted(createStarted)).map(row => row.id), [0, 2]);
      vectors[0].fill(0); assert.equal(tableCloses, 0); assert.equal(dbCloses, 0);
      createComplete.resolve();
      assert.deepEqual((await untilStarted(addStarted)).map(row => row.id), [3]);
      vectors[3].fill(0); assert.equal(records.length, 2); assert.equal(tableCloses, 0);
      addComplete.resolve();
      assert.equal((await writing).count, 3);
      assert.deepEqual(records, [0, 2, 3].map(id => ({ id, vector: [...dequantizeUint8ToFloat32(originalVectors[id])] })));
      assert.equal(tableCloses, 1); assert.equal(dbCloses, 1);
    } finally { createComplete.resolve(); addComplete.resolve(); await writing.catch(() => {}); }
  }
} finally { hooks.deregister(); delete globalThis[key]; await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual array/stream Lance writer delayed columnar consumption controls authored; execution deferred.');
