import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { createTempPath, replaceFile } from './atomic.js';

const require = createRequire(import.meta.url);
let hnswLib = null;
let hnswLoadError = null;
let hnswWarned = false;

const loadHnswLib = () => {
  if (hnswLib || hnswLoadError) return { lib: hnswLib, error: hnswLoadError };
  try {
    hnswLib = require('hnswlib-node');
  } catch (err) {
    hnswLoadError = err;
  }
  return { lib: hnswLib, error: hnswLoadError };
};

export const createHnswBuilder = ({ enabled, config, totalChunks, mode, logger }) => {
  const { lib, error } = loadHnswLib();
  const HierarchicalNSW = lib?.default?.HierarchicalNSW || lib?.HierarchicalNSW || null;
  if (enabled && error && !hnswWarned) {
    hnswWarned = true;
    const message = `[embeddings] HNSW disabled; failed to load hnswlib-node (${error?.code || 'load_error'}).`;
    if (logger?.warn) {
      logger.warn(message);
    } else {
      console.warn(message);
    }
  }
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
      try {
        await fs.rm(`${indexPath}.bak`, { force: true });
      } catch {}
      await replaceFile(tempHnswPath, indexPath, { keepBackup: true });
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
