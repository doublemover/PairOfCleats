import { normalizeVec, quantizeVecUint8 } from '../../embedding.js';
import { resolveEmbeddingBatchSize } from '../embedding-batch.js';

// Empty marker used throughout the indexing pipeline to indicate a missing doc vector.
// Downstream code treats a zero-length Uint8Array as "missing doc" and substitutes a
// shared zero-vector for dot products without allocating per-chunk.
const EMPTY_U8 = new Uint8Array(0);

export async function attachEmbeddings({
  chunks,
  codeTexts,
  docTexts,
  embeddingEnabled,
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
    for (let i = 0; i < docIndexes.length; i += 1) {
      docVectors[docIndexes[i]] = embeddedDocs[i] || null;
    }
  }

  // Avoid allocating a full zero-vector per chunk when docs are missing.
  // Most code chunks have no doc payload; allocating `dims` zeros for each chunk
  // is a major memory multiplier for large indexes.
  const missingDoc = [];

  // Capture a best-effort dimension hint for missing vectors so we can still emit
  // fixed-length byte vectors for every chunk. If a chunk ends up with no code/doc
  // embedding (e.g., upstream service failure), we store a shared "zero" byte vector
  // instead of an empty one to keep downstream consumers consistent.
  let dimsHint = 0;
  for (const v of codeVectors || []) {
    if (Array.isArray(v) && v.length) {
      dimsHint = v.length;
      break;
    }
  }
  if (!dimsHint) {
    for (const v of docVectors || []) {
      if (Array.isArray(v) && v.length) {
        dimsHint = v.length;
        break;
      }
    }
  }
  const zeroU8 = dimsHint ? new Uint8Array(dimsHint).fill(128) : EMPTY_U8;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const embedCode = Array.isArray(codeVectors[i]) ? codeVectors[i] : [];
    const rawDoc = docVectors[i];
    const hasDoc = Array.isArray(rawDoc) && rawDoc.length;
    const embedDoc = hasDoc ? rawDoc : missingDoc;
    const merged = embedCode.length
      ? (hasDoc
        ? embedCode.map((v, idx) => (v + (rawDoc[idx] ?? 0)) / 2)
        : embedCode)
      : (hasDoc ? rawDoc : missingDoc);

    // Normalize + quantize immediately. Holding full float embeddings for every chunk
    // dramatically increases peak heap usage during indexing.
    const mergedNorm = merged.length ? normalizeVec(merged) : null;
    const mergedU8 = mergedNorm && mergedNorm.length ? quantizeVecUint8(mergedNorm) : zeroU8;
    const codeU8 = embedCode.length ? quantizeVecUint8(embedCode) : mergedU8;
    const docU8 = hasDoc ? quantizeVecUint8(rawDoc) : EMPTY_U8;

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
