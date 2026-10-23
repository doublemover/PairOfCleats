import { getInlineEmbeddingBatcher } from '../../../shared/embedding-inline-batcher.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { isVectorLike } from '../../../shared/embedding-utils.js';
import { postprocessEmbeddingChannels } from '../../../shared/embedding-postprocess.js';
import { resolveEmbeddingBatchSize } from '../embedding-batch.js';
import { resolveEmbeddingQuantizationSpec } from '../../../shared/embedding-quantization-spec.js';

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

export async function attachEmbeddings({
  chunks,
  codeTexts,
  docTexts,
  abortSignal = null,
  embeddingEnabled,
  embeddingNormalize,
  quantization = {},
  getChunkEmbedding,
  getChunkEmbeddings,
  runEmbedding,
  embeddingBatchSize,
  fileLanguageId,
  languageOptions
}) {
  throwIfAborted(abortSignal);
  const spec = resolveEmbeddingQuantizationSpec(quantization);
  if (!embeddingEnabled) {
    for (const chunk of chunks) {
      chunk.embed_code = [];
      chunk.embed_doc = [];
      chunk.embedding = [];
    }
    return { embeddingMs: 0 };
  }
  throwIfAborted(abortSignal);

  const embedStart = Date.now();
  if (!Array.isArray(codeTexts) || codeTexts.length !== chunks.length || (Array.isArray(docTexts) && docTexts.length > chunks.length)) {
    throw new Error('[embeddings] Code text/chunk mapping size mismatch.');
  }
  const docVectors = new Array(chunks.length).fill(null), docIndexes = [];
  const payloads = codeTexts.slice();
  for (let index = 0; index < chunks.length; index++) if (docTexts?.[index]) {
    docIndexes.push(index); payloads.push(docTexts[index]);
  }
  const provider = typeof getChunkEmbeddings === 'function' ? getChunkEmbeddings : async texts => {
    const outputs = [];
    for (const text of texts) outputs.push(await getChunkEmbedding(text));
    return outputs;
  };
  const batchSize = resolveEmbeddingBatchSize(embeddingBatchSize, fileLanguageId, languageOptions?.embeddingBatchMultipliers);
  const outputs = await getInlineEmbeddingBatcher(provider).request(payloads, {
    signal: abortSignal, batchSize, tokenBudget: provider.batchTokenBudget ?? 8192,
    run: typeof runEmbedding === 'function' ? runEmbedding : fn => fn()
  });
  throwIfAborted(abortSignal);
  const codeVectors = outputs.slice(0, chunks.length);
  docIndexes.forEach((index, slot) => { docVectors[index] = outputs[chunks.length + slot]; });
  outputs.length = 0;
  const codeDims = assertVectorBatch('code', codeVectors, chunks.length);
  assertVectorBatch('doc', docVectors, chunks.length, codeDims);

  const shouldNormalize = embeddingNormalize !== false;
  for (let i = 0; i < chunks.length; i += 1) {
    throwIfAborted(abortSignal);
    const chunk = chunks[i];
    const embedCode = isVectorLike(codeVectors[i]) ? codeVectors[i] : EMPTY_FLOAT;
    const rawDoc = docVectors[i];
    const hasDoc = isVectorLike(rawDoc) && rawDoc.length;
    const quantized = postprocessEmbeddingChannels({ codeVector: embedCode, docVector: hasDoc ? rawDoc : EMPTY_FLOAT,
      normalize: shouldNormalize, quantization: spec });
    const mergedU8 = quantized.quantizedMerged.length ? quantized.quantizedMerged : EMPTY_U8;
    const codeU8 = quantized.quantizedCode.length ? quantized.quantizedCode : EMPTY_U8;
    const docU8 = quantized.quantizedDoc.length ? quantized.quantizedDoc : EMPTY_U8;

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
