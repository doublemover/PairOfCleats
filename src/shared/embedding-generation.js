import { createHash } from 'node:crypto';
import { stableStringify } from './stable-json.js';

/** Bind vector ordinals, their source chunks and every backend's exact input. */
export const buildEmbeddingGeneration = ({ embeddingIdentity, chunksByFile, vectors }) => {
  const hash = createHash('sha256');
  const add = value => {
    const bytes = Buffer.from(stableStringify(value));
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  };
  add({ version: 1, embeddingIdentity });
  for (const [file, chunks] of [...chunksByFile].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    add(file);
    for (const entry of [...chunks].sort((a, b) => a.index - b.index)) add(entry);
  }
  for (const variant of ['merged', 'doc', 'code']) {
    const rows = vectors[variant];
    add([variant, rows.length]);
    for (const row of rows) {
      if (!row?.length) { add(null); continue; }
      // Quantized rows are uint8. Frame each row, including gaps and its width.
      hash.update(`${row.length}:`);
      hash.update(row instanceof Uint8Array ? row : Uint8Array.from(row));
    }
  }
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
