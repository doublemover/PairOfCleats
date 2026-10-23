export const E5_CODE_RETRIEVAL_TASK = 'Given a code search query, retrieve relevant source code or documentation passages that answer the query';

// Finite semantic contracts, qualified from the authors' recipes. These describe
// preprocessing/output meaning; artifact owners separately verify exact bytes.
// https://huggingface.co/Xenova/bge-m3#usage-transformersjs
// https://huggingface.co/intfloat/multilingual-e5-large-instruct#usage
const CONTRACTS = new Map([
  ['xenova/bge-m3', Object.freeze({
    id: 'xenova-bge-m3-dense-cls-v1', version: 1, family: 'bge-m3',
    pooling: 'cls', output: 'last_hidden_state', rank: 3, dimensions: 1024,
    maxLength: 8192, normalize: true, queryPrefix: null, passagePrefix: null,
    task: null, source: 'https://huggingface.co/Xenova/bge-m3#usage-transformersjs'
  })],
  ['intfloat/multilingual-e5-large-instruct', Object.freeze({
    id: 'multilingual-e5-large-instruct-code-retrieval-v1', version: 1, family: 'e5-instruct',
    pooling: 'mean', output: 'last_hidden_state', rank: 3, dimensions: 1024,
    maxLength: 512, normalize: true,
    queryPrefix: `Instruct: ${E5_CODE_RETRIEVAL_TASK}\nQuery: `, passagePrefix: null,
    task: E5_CODE_RETRIEVAL_TASK, source: 'https://huggingface.co/intfloat/multilingual-e5-large-instruct#usage'
  })]
]);

export const resolveEmbeddingDenseContract = modelId => {
  const id = String(modelId || '').trim().toLowerCase();
  const contract = CONTRACTS.get(id);
  if (contract) return contract;
  if (/(^|\/)bge-m3(?:[-_]|$)/i.test(id) || /(^|\/)(?:multilingual-)?e5[^/]*instruct/i.test(id)) {
    throw Object.assign(new Error(`Embedding model "${modelId}" has no qualified dense encoding contract. Select Xenova/bge-m3 or intfloat/multilingual-e5-large-instruct, or qualify its export and pooling first.`), {
      code: 'ERR_EMBEDDING_MODEL_CONTRACT'
    });
  }
  return null;
};

export const denseContractFormatting = contract => ({
  family: contract.family, queryPrefix: contract.queryPrefix, passagePrefix: contract.passagePrefix,
  contract: contract.id, templateVersion: contract.version, task: contract.task
});

/** Persisted input bytes must agree with the encoder being instantiated now.
 * Older prefixed/mean M3 and legacy-prefixed instruct generations need rebuilds.
 */
export const assertEmbeddingDenseFormatting = (contract, formatting) => {
  if (!contract || !formatting) return;
  const expected = denseContractFormatting(contract);
  for (const key of Object.keys(expected)) {
    if (formatting[key] !== expected[key]) throw Object.assign(new Error(
      `Persisted embedding formatting does not match ${contract.id}. Rebuild the dense index.`
    ), { code: 'ERR_EMBEDDING_MODEL_CONTRACT' });
  }
};

export const validateEmbeddingDenseContract = (contract, { normalize } = {}) => {
  if (contract?.normalize && normalize === false) throw Object.assign(new Error(
    `${contract.id} requires normalized dense embeddings.`
  ), { code: 'ERR_EMBEDDING_MODEL_CONTRACT' });
};
