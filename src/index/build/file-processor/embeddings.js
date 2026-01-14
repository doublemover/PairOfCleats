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

  const coerceVector = (value) => {
    if (Array.isArray(value)) return value;
    if (ArrayBuffer.isView(value)) return Array.from(value);
    return null;
  };

  const validateBatchOutput = ({ label, vectors, expectedCount }) => {
    if (!Array.isArray(vectors)) {
      throw new Error(`[embeddings] ${label} embedder returned a non-array result.`);
    }
    if (vectors.length !== expectedCount) {
      throw new Error(
        `[embeddings] ${label} embedder returned ${vectors.length} vectors; expected ${expectedCount}.`
      );
    }
    let dims = 0;
    const out = new Array(expectedCount);
    for (let i = 0; i < expectedCount; i += 1) {
      const vec = coerceVector(vectors[i]);
      if (!vec) {
        throw new Error(`[embeddings] ${label} embedder returned a non-vector at index ${i}.`);
      }
      if (expectedCount > 0 && vec.length <= 0) {
        throw new Error(`[embeddings] ${label} embedder returned an empty vector at index ${i}.`);
      }
      if (!dims) dims = vec.length;
      if (dims && vec.length !== dims) {
        throw new Error(
          `[embeddings] ${label} embedder dims mismatch at index ${i} (expected ${dims}, got ${vec.length}).`
        );
      }
      out[i] = vec;
    }
    return { vectors: out, dims };
  };

  const expectedChunkCount = Array.isArray(chunks) ? chunks.length : 0;
  if (Array.isArray(codeTexts) && codeTexts.length !== expectedChunkCount) {
    throw new Error(
      `[embeddings] code payload count mismatch (texts=${codeTexts.length}, chunks=${expectedChunkCount}).`
    );
  }
  if (Array.isArray(docTexts) && docTexts.length !== expectedChunkCount) {
    throw new Error(
      `[embeddings] doc payload count mismatch (texts=${docTexts.length}, chunks=${expectedChunkCount}).`
    );
  }
  let codeVectors = await runEmbedding(() => runBatched(codeTexts || []));
  if (!Array.isArray(codeVectors) || codeVectors.length !== expectedChunkCount) {
    codeVectors = await runEmbedding(async () => {
      const out = [];
      for (const text of codeTexts || []) {
        out.push(await getChunkEmbedding(text));
      }
      return out;
    });
  }
  const validatedCode = validateBatchOutput({
    label: 'code',
    vectors: codeVectors,
    expectedCount: expectedChunkCount
  });

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
    const validatedDocs = validateBatchOutput({
      label: 'doc',
      vectors: embeddedDocs,
      expectedCount: docPayloads.length
    });
    for (let i = 0; i < docIndexes.length; i += 1) {
      docVectors[docIndexes[i]] = validatedDocs.vectors[i] || null;
    }
  }

  const docDims = docPayloads.length && Array.isArray(docVectors[docIndexes[0]])
    ? docVectors[docIndexes[0]].length
    : 0;
  if (validatedCode.dims && docDims && validatedCode.dims !== docDims) {
    throw new Error(
      `[embeddings] dims mismatch (code=${validatedCode.dims}, doc=${docDims}).`
    );
  }
  const dims = validatedCode.dims || docDims || 0;
  if (expectedChunkCount && !dims) {
    throw new Error('[embeddings] embedder returned no usable vector dims.');
  }
  const zeroVec = dims ? new Array(dims).fill(0) : [];
  for (let i = 0; i < expectedChunkCount; i += 1) {
    const chunk = chunks[i];
    const embedCode = validatedCode.vectors[i] || [];
    const embedDoc = Array.isArray(docVectors[i]) ? docVectors[i] : zeroVec;
    const merged = embedCode.length
      ? embedCode.map((v, idx) => (v + (embedDoc[idx] ?? 0)) / 2)
      : embedDoc;
    chunk.embed_code = embedCode;
    chunk.embed_doc = embedDoc;
    chunk.embedding = normalizeVec(merged);
  }

  return { embeddingMs: Date.now() - embedStart };
}
