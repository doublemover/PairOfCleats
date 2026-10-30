import { createHash } from 'node:crypto';
import { loadChunkMeta } from '../shared/artifact-io/loaders/chunk-meta.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';

/** Source/chunking provenance excludes model-specific build/cache identity. */
export const resolveRetrievalCorpusIdentity = async (indexDir, mode) => {
  try {
    const chunks = await loadChunkMeta(indexDir, { strict: true });
    const records = chunks.map(chunk => {
      if (!chunk?.file || !chunk?.fileHash) throw new Error('Source file/hash evidence is missing from comparison chunks.');
      return [mode, chunk.file, chunk.fileHash, chunk.start, chunk.end, chunk.kind || null, chunk.name || null];
    }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    return { comparable: true, policy: 'source-file-hash-and-chunk-ranges.v1', count: records.length,
      digest: createHash('sha256').update(JSON.stringify(records)).digest('hex') };
  } catch (error) {
    observeStorageResource(error,{phase:'comparison-corpus-admission'}).requireSettled();
    return { comparable: false, policy: 'source-file-hash-and-chunk-ranges.v1', digest: null, reason: error.message };
  }
};
