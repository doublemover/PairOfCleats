import PQueue from 'p-queue';
import { normalizeVec, quantizeVecUint8 } from '../../embedding.js';
import { runWithQueue } from '../../../shared/concurrency.js';
import { isVectorLike, mergeEmbeddingVectors } from '../../../shared/embedding-utils.js';
import { resolveEmbeddingBatchSize } from '../embedding-batch.js';

// Empty marker used throughout the indexing pipeline to indicate a missing doc vector.
// Downstream code treats a zero-length Uint8Array as "missing doc" and substitutes a
// shared zero-vector for dot products without allocating per-chunk.
const EMPTY_U8 = new Uint8Array(0);
const EMPTY_FLOAT = new Float32Array(0);

const assertVectorBatch = (label, vectors, expectedCount, expectedDims = 0) => {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(
      `[embeddings] ${label} embedding batch size mismatch (expected ${expectedCount}, got ${vectors?.length ?? 0}).`
    );
  }
  let dims = expectedDims || 0;
  for (const vec of vectors) {
    if (vec == null) continue;
    if (!isVectorLike(vec)) {
      throw new Error(`[embeddings] ${label} embedding output is not vector-like.`);
    }
    if (!vec.length) continue;
    if (dims && vec.length !== dims) {
      throw new Error(
        `[embeddings] ${label} embedding dims mismatch (configured=${dims}, observed=${vec.length}).`
      );
    }
    if (!dims) dims = vec.length;
  }
  return dims;
};

const batcherCache = new WeakMap();

const createBatcher = (embed, batchSize) => {
  let queue = [];
  let flushing = false;
  let scheduled = false;
  let needsFlush = false;
  const size = Math.max(1, Math.floor(batchSize));
  const batchQueue = new PQueue({ concurrency: 1 });

  const flush = async () => {
    if (flushing) {
      needsFlush = true;
      return;
    }
    flushing = true;
    do {
      needsFlush = false;
      if (!queue.length) continue;
      const batches = [];
      while (queue.length) {
        batches.push(queue.splice(0, size));
      }
      await runWithQueue(
        batchQueue,
        batches,
        async (batch) => {
          const payload = batch.map((item) => item.text);
          try {
            const outputs = await embed(payload);
            if (!Array.isArray(outputs) || outputs.length !== batch.length) {
              throw new Error(`embedding batch size mismatch (expected ${batch.length}, got ${outputs?.length ?? 0})`);
            }
            for (let i = 0; i < batch.length; i += 1) {
              batch[i].resolve(outputs[i] ?? []);
            }
          } catch (err) {
            for (const item of batch) {
              item.reject(err);
            }
          }
        },
        {
          collectResults: false,
          bestEffort: true
        }
      );
    } while (needsFlush || queue.length);
    flushing = false;
  };

  const scheduleFlush = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      void flush();
    });
  };

  const embedAll = async (texts) => {
    if (!texts.length) return [];
    const promises = texts.map(
      (text) => new Promise((resolve, reject) => {
        queue.push({ text, resolve, reject });
      })
    );
    if (queue.length >= size) {
      void flush();
    } else {
      scheduleFlush();
    }
    return Promise.all(promises);
  };

  return { embed: embedAll };
};

const getBatcher = (embed, batchSize) => {
  if (!embed || !Number.isFinite(batchSize) || batchSize <= 0) return null;
  const cached = batcherCache.get(embed);
  if (cached && cached.batchSize === batchSize) return cached.batcher;
  const batcher = createBatcher(embed, batchSize);
  batcherCache.set(embed, { batchSize, batcher });
  return batcher;
};

export async function attachEmbeddings({
  chunks,
  codeTexts,
  docTexts,
  embeddingEnabled,
  embeddingNormalize,
  getChunkEmbedding,
  getChunkEmbeddings,
  runEmbedding,
  embeddingBatchSize,
  fileLanguageId,
  languageOptions
}) {
  if (!embeddingEnabled) {
    for (const chunk of chunks) {
      chunk.embed_code = [];
      chunk.embed_doc = [];
      chunk.embedding = [];
    }
    return { embeddingMs: 0 };
  }

  const embedStart = Date.now();
  const embedBatch = async (texts) => {
    if (!texts.length) return [];
    if (typeof getChunkEmbeddings === 'function') {
      return getChunkEmbeddings(texts);
    }
    const out = [];
    for (const text of texts) {
      out.push(await getChunkEmbedding(text));
    }
    return out;
  };

  const runBatched = async (texts) => {
    if (!texts.length) return [];
    const effectiveBatchSize = resolveEmbeddingBatchSize(
      embeddingBatchSize,
      fileLanguageId,
      languageOptions?.embeddingBatchMultipliers
    );
    const batchSize = Number.isFinite(effectiveBatchSize) ? effectiveBatchSize : 0;
    if (typeof getChunkEmbeddings === 'function' && batchSize) {
      const batcher = getBatcher(getChunkEmbeddings, batchSize);
      if (batcher) {
        return batcher.embed(texts);
      }
    }
    if (!batchSize || texts.length <= batchSize) {
      return embedBatch(texts);
    }
    const out = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const batch = await embedBatch(slice);
      out.push(...batch);
    }
    return out;
  };

  let codeVectors = await runEmbedding(() => runBatched(codeTexts || []));
  if (!Array.isArray(codeVectors) || codeVectors.length !== chunks.length) {
    codeVectors = await runEmbedding(async () => {
      const out = [];
      for (const text of codeTexts || []) {
        out.push(await getChunkEmbedding(text));
      }
      return out;
    });
  }
  const codeDims = assertVectorBatch('code', codeVectors, chunks.length);

  const docVectors = new Array(chunks.length).fill(null);
  const docIndexes = [];
  const docPayloads = [];
  for (let i = 0; i < (docTexts || []).length; i += 1) {
    if (docTexts[i]) {
      docIndexes.push(i);
      docPayloads.push(docTexts[i]);
    }
  }
  if (docPayloads.length) {
    const embeddedDocs = await runEmbedding(() => runBatched(docPayloads));
    if (!Array.isArray(embeddedDocs) || embeddedDocs.length !== docPayloads.length) {
      throw new Error(
        `[embeddings] doc embedding batch size mismatch (expected ${docPayloads.length}, got ${embeddedDocs?.length ?? 0}).`
      );
    }
    for (let i = 0; i < docIndexes.length; i += 1) {
      docVectors[docIndexes[i]] = embeddedDocs[i] || null;
    }
  }
  const docDims = assertVectorBatch('doc', docVectors, chunks.length, codeDims);
  const mergedDims = codeDims || docDims;

  // Avoid allocating a full zero-vector per chunk when docs are missing.
  // Most code chunks have no doc payload; allocating `dims` zeros for each chunk
  // is a major memory multiplier for large indexes.
  const missingDoc = EMPTY_FLOAT;

  // Capture a best-effort dimension hint for missing vectors so we can still emit
  // fixed-length byte vectors for every chunk. If a chunk ends up with no code/doc
  // embedding (e.g., upstream service failure), we store a shared "zero" byte vector
  // instead of an empty one to keep downstream consumers consistent.
  const zeroU8 = mergedDims ? new Uint8Array(mergedDims).fill(128) : EMPTY_U8;

  const shouldNormalize = embeddingNormalize !== false;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const embedCode = isVectorLike(codeVectors[i]) ? codeVectors[i] : EMPTY_FLOAT;
    const rawDoc = docVectors[i];
    const hasDoc = isVectorLike(rawDoc) && rawDoc.length;
    const merged = mergeEmbeddingVectors({ codeVector: embedCode, docVector: hasDoc ? rawDoc : missingDoc });

    // Normalize (when enabled) + quantize immediately. Holding full float embeddings for every chunk
    // dramatically increases peak heap usage during indexing.
    const codeNorm = embedCode.length
      ? (shouldNormalize ? normalizeVec(embedCode) : embedCode)
      : null;
    const docNorm = hasDoc
      ? (shouldNormalize ? normalizeVec(rawDoc) : rawDoc)
      : null;
    const mergedNorm = merged.length
      ? (shouldNormalize ? normalizeVec(merged) : merged)
      : null;
    const mergedU8 = mergedNorm && mergedNorm.length ? quantizeVecUint8(mergedNorm) : zeroU8;
    const codeU8 = codeNorm && codeNorm.length ? quantizeVecUint8(codeNorm) : mergedU8;
    const docU8 = docNorm && docNorm.length ? quantizeVecUint8(docNorm) : EMPTY_U8;

    chunk.embedding_u8 = mergedU8;
    chunk.embed_code_u8 = codeU8;
    chunk.embed_doc_u8 = docU8;

    // Drop float vectors to avoid retaining large arrays in the long-lived build state.
    delete chunk.embed_code;
    delete chunk.embed_doc;
    delete chunk.embedding;

    // Help GC by clearing references from the per-file vector arrays.
    if (Array.isArray(codeVectors)) codeVectors[i] = null;
    docVectors[i] = null;
  }

  return { embeddingMs: Date.now() - embedStart };
}
