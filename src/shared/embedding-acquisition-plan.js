// Author's immutable ONNX export; its 389 initializers are TensorProto FLOAT.
// https://huggingface.co/intfloat/multilingual-e5-large-instruct/commit/c9e87c786ffac96aeaeb42863276930883923ecb
// The author config omits Transformers.js's external-data declaration. Keep
// that loader policy explicit; selecting fp32 alone does not acquire the data.
export const E5_INSTRUCT_REVISION = 'c9e87c786ffac96aeaeb42863276930883923ecb';
const E5_FILES = Object.freeze([
  Object.freeze({ path: 'onnx/model.onnx', bytes: 686499,
    sha256: 'e3aeea5355352d826bd952a9a96fab206c6c72d1a429c8773c9da5ac16e44af5' }),
  Object.freeze({ path: 'onnx/model.onnx_data', bytes: 2235367440,
    sha256: '4c13ca44e40a7ee86b461398cdee003d656e39f3fa87e1b3152fbada3e61b506' })
]);

/** Shared exact loader selection; no precision or namespace fallback. */
export const resolveEmbeddingAcquisitionPlan = (modelId, profile = null) => {
  if (modelId === 'intfloat/multilingual-e5-large-instruct') return {
    version: 1, modelId, runtime: 'transformers.js@4.3.2', revision: E5_INSTRUCT_REVISION,
    dtype: 'fp32', textOnly: false, useExternalDataFormat: true, exportFiles: E5_FILES
  };
  return {
    version: 1, modelId, runtime: profile?.runtime ?? null,
    revision: profile?.revision ?? null, dtype: profile?.dtype ?? 'q8',
    textOnly: profile?.textOnly === true
  };
};

/** Exact author graph/data identities supplement the opened-byte receipt. */
export const assertEmbeddingAcquisitionExport = (plan, inventory) => {
  if (!plan.exportFiles) return;
  const selected = inventory.filter(row => row.path.startsWith('onnx/'));
  if (selected.length !== plan.exportFiles.length || plan.exportFiles.some(expected => {
    const actual = selected.find(row => row.path === expected.path);
    return !actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256;
  })) throw Object.assign(new Error('Selected model bytes disagree with its qualified ONNX export.'), {
    code: 'ERR_EMBEDDING_ACQUISITION'
  });
};
