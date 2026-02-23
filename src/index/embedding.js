import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';
import {
  formatEmbeddingInput,
  formatEmbeddingInputs,
  resolveEmbeddingInputFormatting
} from '../shared/embedding-input-format.js';
import {
  normalizeEmbeddingVector,
  quantizeEmbeddingVector,
  quantizeEmbeddingVectorUint8
} from '../shared/embedding-utils.js';

export const quantizeVec = quantizeEmbeddingVector;

export const quantizeVecUint8 = quantizeEmbeddingVectorUint8;

/**
 * L2-normalize an embedding vector.
 * @param {number[]} vec
 * @returns {number[]}
 */
export const normalizeVec = normalizeEmbeddingVector;

/**
 * Build an embedder wrapper for chunk embeddings.
 * @param {object} options
 * @param {boolean} options.useStubEmbeddings
 * @param {string} options.modelId
 * @param {number} options.dims
 * @param {string} options.modelsDir
 * @returns {{
 *   getChunkEmbedding:(text:string)=>Promise<number[]>,
 *   getChunkEmbeddings:(texts:string[])=>Promise<number[][]>,
 *   embedderPromise:Promise<any>|null,
 *   getActiveProvider:()=>string
 * }}
 */
export function createEmbedder({
  rootDir,
  useStubEmbeddings,
  modelId,
  dims,
  modelsDir,
  provider,
  onnx,
  normalize
}) {
  const adapter = getEmbeddingAdapter({
    rootDir,
    useStub: useStubEmbeddings,
    modelId,
    dims,
    modelsDir,
    provider,
    onnxConfig: onnx,
    normalize
  });
  const inputFormatting = resolveEmbeddingInputFormatting(modelId);

  async function getChunkEmbedding(text) {
    const payload = formatEmbeddingInput(text, {
      modelId,
      kind: 'passage',
      formatting: inputFormatting
    });
    return adapter.embedOne(payload);
  }

  async function getChunkEmbeddings(texts) {
    const payloads = formatEmbeddingInputs(texts, {
      modelId,
      kind: 'passage',
      formatting: inputFormatting
    });
    return adapter.embed(payloads);
  }
  // Surface adapter concurrency capability so embedding pipelines can safely
  // decide whether code/doc batches may run in parallel.
  getChunkEmbeddings.supportsParallelDispatch = adapter?.supportsParallelDispatch === true;
  const getActiveProvider = () => {
    const provider = adapter?.provider;
    return typeof provider === 'string' && provider.trim()
      ? provider
      : 'xenova';
  };

  return {
    getChunkEmbedding,
    getChunkEmbeddings,
    embedderPromise: adapter.embedderPromise,
    getActiveProvider
  };
}
