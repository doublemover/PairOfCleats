import fs from 'node:fs/promises';
import hnswlib from 'hnswlib-node';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { createTempPath, replaceFile } from './atomic.js';

const { HierarchicalNSW } = hnswlib?.default || hnswlib || {};

export const createHnswBuilder = ({ enabled, config, totalChunks, mode }) => {
  let index = null;
  let added = 0;
  let expected = 0;
  const pending = [];

  const isVectorLike = (value) => (
    Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
  );
  const initHnsw = (vector) => {
    if (!enabled || index || !isVectorLike(vector) || !vector.length) return;
    if (!HierarchicalNSW) return;
    index = new HierarchicalNSW(config.space, vector.length);
    index.initIndex({
      maxElements: totalChunks,
      m: config.m,
      efConstruction: config.efConstruction,
      randomSeed: config.randomSeed,
      allowReplaceDeleted: config.allowReplaceDeleted
    });
  };

  const addVector = (chunkIndex, vector) => {
    if (!enabled || !isVectorLike(vector) || !vector.length) return;
    const data = Array.isArray(vector) ? vector : Array.from(vector);
    initHnsw(data);
    if (!index) return;
    expected += 1;
    pending.push({ chunkIndex, vector: data });
  };

  const writeIndex = async ({ indexPath, metaPath, modelId, dims }) => {
    if (!enabled || !index || !expected) return { skipped: true };
    if (pending.length) {
      pending.sort((a, b) => a.chunkIndex - b.chunkIndex);
      for (const entry of pending) {
        try {
          index.addPoint(entry.vector, entry.chunkIndex);
          added += 1;
        } catch {
          // Ignore HNSW insert failures.
        }
      }
    }
    if (expected !== added) {
      throw new Error(`HNSW insert count mismatch (${added} of ${expected}).`);
    }
    const tempHnswPath = createTempPath(indexPath);
    try {
      index.writeIndexSync(tempHnswPath);
      await replaceFile(tempHnswPath, indexPath);
    } catch (err) {
      try {
        await fs.rm(tempHnswPath, { force: true });
      } catch {}
      throw err;
    }
    const hnswMeta = {
      version: 1,
      generatedAt: new Date().toISOString(),
      model: modelId || null,
      dims,
      count: added,
      expectedCount: expected,
      space: config.space,
      m: config.m,
      efConstruction: config.efConstruction,
      efSearch: config.efSearch
    };
    await writeJsonObjectFile(metaPath, { fields: hnswMeta, atomic: true });
    return { skipped: false, count: added };
  };

  const getStats = () => ({ added, expected, ready: !!index });

  return {
    addVector,
    writeIndex,
    getStats
  };
};
