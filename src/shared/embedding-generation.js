import { createHash } from 'node:crypto';
import { stableStringify } from './stable-json.js';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { throwIfAborted } from './abort.js';

const createDigest = embeddingIdentity => {
  const hash = createHash('sha256');
  const add = value => {
    const bytes = Buffer.from(stableStringify(value));
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };
  const row = value => {
    if (!value?.length) { add(null); return; }
    hash.update(`${value.length}:`);
    hash.update(value instanceof Uint8Array ? value : Uint8Array.from(value));
  };
  add({ version: 1, embeddingIdentity });
  return { hash, add, row };
};

/** Bind vector ordinals, their source chunks and every backend's exact input. */
export const buildEmbeddingGeneration = ({ embeddingIdentity, chunksByFile, vectors }) => {
  const { hash, add, row: addRow } = createDigest(embeddingIdentity);
  for (const [file, chunks] of [...chunksByFile].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    add(file);
    for (const entry of [...chunks].sort((a, b) => a.index - b.index)) add(entry);
  }
  for (const variant of ['merged', 'doc', 'code']) {
    const rows = vectors[variant];
    add([variant, rows.length]);
    for (const row of rows) {
      addRow(row);
    }
  }
  return hash.digest('hex');
};

/** Exact v1 framing/order with bounded range consumption and event-loop yields.
 * The synchronous compatibility entry point above remains an independent call
 * surface for small arrays and parity fixtures. Completion order is never hashed.
 */
export const buildEmbeddingGenerationAsync = async ({ embeddingIdentity, chunksByFile, vectors, signal = null }) => {
  const { hash, add, row: addRow } = createDigest(embeddingIdentity);
  throwIfAborted(signal);
  for (const [file, chunks] of [...chunksByFile].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    add(file);
    for (const entry of [...chunks].sort((a, b) => a.index - b.index)) add(entry);
    await yieldEventLoop(); throwIfAborted(signal);
  }
  for (const variant of ['merged', 'doc', 'code']) {
    const rows = vectors[variant];
    add([variant, rows.length]);
    if (typeof rows.ranges === 'function') {
      let next = 0;
      for (const range of rows.ranges()) {
        throwIfAborted(signal);
        if (range.start !== next || !Number.isSafeInteger(range.count) || range.count <= 0 || next + range.count > rows.length) throw new Error('Invalid embedding generation range order.');
        let count = 0;
        for (const row of range) { addRow(row); count++; }
        if (count !== range.count) throw new Error('Embedding generation range count mismatch.');
        next += count;
        await yieldEventLoop(); throwIfAborted(signal);
      }
      if (next !== rows.length) throw new Error('Embedding generation range coverage incomplete.');
    } else {
      for (let index = 0; index < rows.length; index++) {
        addRow(rows[index]);
        if ((index + 1) % 1024 === 0) { await yieldEventLoop(); throwIfAborted(signal); }
      }
    }
  }
  throwIfAborted(signal);
  return hash.digest('hex');
};

/** This runs before a native backend opens any bytes. Legacy partial identities
 * remain comparable, but a current generation requires a complete binding. */
export const embeddingBindingMismatches = (meta, embeddings) => {
  if (!meta) return embeddings?.embeddingGeneration ? ['embeddingGeneration'] : [];
  const mismatches = [];
  if (embeddings?.embeddingGeneration
    && meta?.embeddingGeneration !== embeddings.embeddingGeneration) mismatches.push('embeddingGeneration');
  const expected = embeddings?.embeddingIdentity;
  const actual = meta?.embeddingIdentity || meta;
  if (expected && actual) {
    for (const key of Object.keys(expected)) {
      // Legacy flat backend metadata has its own format version.
      if (key === 'version' && !meta.embeddingIdentity && !embeddings.embeddingGeneration) continue;
      const value = key === 'modelId' ? actual.modelId ?? actual.model : actual[key];
      if (stableStringify(expected[key]) !== stableStringify(value)) mismatches.push(key);
    }
  }
  return mismatches;
};
