import { getEmbeddingAdapter } from '../shared/embedding-adapter.js';
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
 * @returns {{getChunkEmbedding:(text:string)=>Promise<number[]>,getChunkEmbeddings:(texts:string[])=>Promise<number[][]>,embedderPromise:Promise<any>|null}}
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

  async function getChunkEmbedding(text) {
    return adapter.embedOne(text);
  }

  async function getChunkEmbeddings(texts) {
    return adapter.embed(texts);
  }
  getChunkEmbeddings.supportsParallelDispatch = adapter?.supportsParallelDispatch === true;

  return { getChunkEmbedding, getChunkEmbeddings, embedderPromise: adapter.embedderPromise };
}
