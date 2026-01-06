import { normalizeVec } from '../../embedding.js';
import { resolveEmbeddingBatchSize } from '../embedding-batch.js';

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

  const dims = Array.isArray(codeVectors[0]) ? codeVectors[0].length : 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const embedCode = Array.isArray(codeVectors[i]) ? codeVectors[i] : [];
    const embedDoc = Array.isArray(docVectors[i])
      ? docVectors[i]
      : (dims ? Array.from({ length: dims }, () => 0) : []);
    const merged = embedCode.length
      ? embedCode.map((v, idx) => (v + (embedDoc[idx] ?? 0)) / 2)
      : embedDoc;
    chunk.embed_code = embedCode;
    chunk.embed_doc = embedDoc;
    chunk.embedding = normalizeVec(merged);
  }

  return { embeddingMs: Date.now() - embedStart };
}
