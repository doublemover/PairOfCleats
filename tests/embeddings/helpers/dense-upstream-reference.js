import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTransformersResourceScope } from '../../../src/shared/embedding-transformers-resources.js';
import { preserveEmbeddingCleanupFailure } from '../../../src/shared/embedding-cache-lifetime.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

// These finite recipes transcribe the named authors, independently of product
// formatting, acquisition, pooling, output admission and normalization helpers.
const instruction = 'Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: ';
const recipes = [
  { id: 'm3-raw-cls-l2-v1', modelId: 'Xenova/bge-m3', revision: '46ce10a0ac77ca4bab460d6676ba8260b33e68dc',
    dtype: 'q8', dimensions: 1024, maxLength: 8192, pooling: 'cls', queryPrefix: '',
    source: 'https://huggingface.co/Xenova/bge-m3#usage-transformersjs',
    exportSource: 'https://huggingface.co/Xenova/bge-m3/commit/044d00eef6d42d3695148639ab2b8702b6cb9159',
    cacheSelection: 'same verified generic cache as production; export revision and graph identity frozen by manifest',
    artifacts: [{ path: 'onnx/model_quantized.onnx', bytes: 569694530,
      sha256: '0826f8c1ab9edf1801db86c61919d4d108e8bfc0b809ec823ad366882ff0b77d' }] },
  { id: 'e5-instruct-raw-mask-mean-l2-v1', modelId: 'intfloat/multilingual-e5-large-instruct',
    revision: 'c9e87c786ffac96aeaeb42863276930883923ecb', dtype: 'fp32', dimensions: 1024, maxLength: 512,
    pooling: 'mask-mean', queryPrefix: instruction,
    source: 'https://huggingface.co/intfloat/multilingual-e5-large-instruct#usage',
    exportSource: 'https://huggingface.co/intfloat/multilingual-e5-large-instruct/commit/c9e87c786ffac96aeaeb42863276930883923ecb',
    cacheSelection: 'immutable author revision; explicit external data fetched by upstream before native session creation',
    artifacts: [
      { path: 'onnx/model.onnx', bytes: 686499, sha256: 'e3aeea5355352d826bd952a9a96fab206c6c72d1a429c8773c9da5ac16e44af5' },
      { path: 'onnx/model.onnx_data', bytes: 2235367440, sha256: '4c13ca44e40a7ee86b461398cdee003d656e39f3fa87e1b3152fbada3e61b506' }
    ] }
];
for (const recipe of recipes) {
  for (const row of recipe.artifacts) Object.freeze(row);
  Object.freeze(recipe.artifacts);
  Object.assign(recipe, { runtime: '4.3.2', comparison: 'strict matching input/batch/padding geometry; cross-shape dynamic-quantization drift is descriptive',
    limitation: 'Same verified ONNX export and native runtime, independent scalar author arithmetic; not a PyTorch/export-conversion reference or representative quality claim.' });
  Object.freeze(recipe);
}
export const resolveDenseReferenceRecipe = modelId => recipes.find(recipe => recipe.modelId === modelId) || null;
export const denseReferenceQuery = (recipe, text) => recipe.queryPrefix + text;
export const assertDenseReferenceManifest = (manifest, recipe = resolveDenseReferenceRecipe(manifest.modelId)) => {
  assert.ok(recipe, 'No independent recipe is inferred for another export, plain E5, M3 alias or EG2.');
  assert.equal(manifest.provider, 'xenova'); assert.equal(manifest.modelId, recipe.modelId);
  assert.equal(manifest.exportRevision, recipe.revision); assert.equal(manifest.dimensions, recipe.dimensions);
  assert.equal(manifest.normalize, true); assert.equal(manifest.tolerance, 1e-5);
  assert.equal(manifest.modelProfile ?? null, null); assert.equal(manifest.onnxConfig ?? null, null);
  assert.equal(manifest.runtime.transformers, recipe.runtime);
  const weights = manifest.artifacts.filter(row => row.path.startsWith('onnx/'));
  assert.deepEqual(weights.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), recipe.artifacts);
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
    assert.ok(manifest.artifacts.some(row => row.path === file && row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256)),
      'The independently acquired tokenizer/config closure must also be frozen.');
  }
};
const tensors = (scope, values, role) => {
  const seen = new Set();
  for (const value of Object.values(values)) if (value && Array.isArray(value.dims) && ArrayBuffer.isView(value.data) && !seen.has(value)) {
    seen.add(value); scope.adopt(value, role);
  }
};
const tensorReceipt = tensor => {
  assert.ok(tensor && ArrayBuffer.isView(tensor.data));
  return { dtype: tensor.type, dimensions: [...tensor.dims], bytes: tensor.data.byteLength,
    sha256: createHash('sha256').update(Buffer.from(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength)).digest('hex') };
};

/** Independent reference arithmetic over the original raw token tensor. */
export const scalarDenseReference = ({ hidden, mask, count, recipe, signal = null }) => {
  assert.ok(['cls', 'mask-mean'].includes(recipe.pooling), 'No pooling semantics are inferred for another output.');
  assert.equal(hidden?.type, 'float32'); assert.ok(hidden.data instanceof Float32Array);
  assert.equal(hidden.dims.length, 3); assert.equal(mask?.dims.length, 2);
  const [rows, sequence, width] = hidden.dims;
  assert.equal(rows, count); assert.equal(width, 1024);
  assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 64);
  assert.ok(Number.isSafeInteger(sequence) && sequence > 0 && sequence <= recipe.maxLength);
  assert.equal(hidden.data.length, count * sequence * width); assert.equal(mask.data.length, count * sequence);
  assert.deepEqual(mask.dims, [count, sequence]);
  assert.ok(['int64', 'int32'].includes(mask.type));
  assert.ok(mask.type === 'int64' ? mask.data instanceof BigInt64Array : mask.data instanceof Int32Array);
  const vectors = [], tokenCounts = [];
  for (let row = 0; row < count; row++) {
    throwIfAborted(signal);
    const sums = new Float64Array(width); let tokens = 0;
    for (let token = 0; token < sequence; token++) {
      const weight = Number(mask.data[row * sequence + token]); assert.ok(weight === 0 || weight === 1);
      if (recipe.pooling === 'cls' && token === 0) assert.equal(weight, 1, 'CLS must be the first admitted token.');
      tokens += weight;
      for (let column = 0; column < width; column++) {
        const value = hidden.data[(row * sequence + token) * width + column]; assert.ok(Number.isFinite(value));
        if (recipe.pooling === 'cls') { if (token === 0) sums[column] = value; }
        else sums[column] += value * weight;
      }
    }
    assert.ok(tokens > 0); tokenCounts.push(tokens);
    let squared = 0;
    for (let column = 0; column < width; column++) {
      if (recipe.pooling === 'mask-mean') sums[column] /= tokens;
      squared += sums[column] * sums[column];
    }
    assert.ok(Number.isFinite(squared) && squared > 0);
    const vector = new Float32Array(width), norm = Math.sqrt(squared);
    for (let column = 0; column < width; column++) vector[column] = sums[column] / norm;
    vectors.push(vector);
  }
  return { vectors, tokenCounts };
};

export const createDenseUpstreamReference = async ({ transformers, manifest, signal }) => {
  const recipe = resolveDenseReferenceRecipe(manifest.modelId);
  assertDenseReferenceManifest(manifest, recipe); throwIfAborted(signal);
  assert.equal(transformers.env?.version, recipe.runtime);
  const lifetime = createTransformersResourceScope('actual dense raw reference components', { drainFailuresBeforeResources: true });
  const e5 = recipe.pooling === 'mask-mean';
  const selection = { cache_dir: manifest.modelsDir, local_files_only: true, ...(e5 ? { revision: recipe.revision } : {}) };
  let tokenizer, model;
  try {
    const original = await transformers.AutoConfig.from_pretrained(manifest.modelId, selection);
    assert.equal(original.model_type, 'xlm-roberta'); assert.equal(original.hidden_size, 1024);
    const config = e5 ? { ...original, 'transformers.js_config': { ...original['transformers.js_config'], use_external_data_format: true } } : original;
    throwIfAborted(signal);
    tokenizer = lifetime.adopt(await transformers.AutoTokenizer.from_pretrained(manifest.modelId, selection), 'raw author tokenizer');
    assert.equal(typeof tokenizer, 'function');
    throwIfAborted(signal);
    model = lifetime.adopt(await transformers.AutoModel.from_pretrained(manifest.modelId, { ...selection, config,
      dtype: recipe.dtype, device: 'cpu', ...(e5 ? { use_external_data_format: true } : {}),
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } }), 'raw author model');
    assert.equal(typeof model, 'function');
    throwIfAborted(signal);
  } catch (error) {
    lifetime.retainFailure(error);
    try { await lifetime.close(); } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
  const embed = async texts => {
    assert.ok(Array.isArray(texts) && texts.length > 0 && texts.length <= 64);
    throwIfAborted(signal);
    const scope = createTransformersResourceScope('actual dense raw reference tensors', { drainFailuresBeforeResources: true });
    let result, failure, failed = false;
    try {
      const input = await tokenizer(texts, { padding: true, truncation: true, max_length: recipe.maxLength });
      tensors(scope, input, 'raw author input'); throwIfAborted(signal);
      assert.equal(input.input_ids?.dims.length, 2); assert.equal(input.input_ids.dims[0], texts.length);
      assert.deepEqual(input.input_ids.dims, input.attention_mask?.dims);
      assert.equal(input.input_ids.data.length, input.input_ids.dims[0] * input.input_ids.dims[1]);
      const output = await model(input);
      tensors(scope, output, 'raw author output'); throwIfAborted(signal);
      const { vectors, tokenCounts } = scalarDenseReference({ hidden: output.last_hidden_state, mask: input.attention_mask,
        count: texts.length, recipe, signal });
      result = { vectors, tokenization: { inputIds: tensorReceipt(input.input_ids), attentionMask: tensorReceipt(input.attention_mask), tokenCounts },
        rawOutput: tensorReceipt(output.last_hidden_state), outputBytes: texts.length * 1024 * 4 };
    } catch (error) { failed = true; failure = error; scope.retainFailure(error); }
    try { await scope.close(); } catch (cleanup) { throw failed ? preserveEmbeddingCleanupFailure(failure, cleanup) : cleanup; }
    if (failed) throw failure;
    throwIfAborted(signal); return result;
  };
  return { recipe, embed, close: () => lifetime.close() };
};

export const measureDenseReferenceVectors = (actual, expected, tolerance) => {
  assert.ok(Number.isFinite(tolerance) && tolerance > 0 && tolerance <= 1e-5);
  assert.equal(actual.length, expected.length); assert.ok(actual.length > 0);
  let maxAbsoluteError = 0, minimumCosine = 1;
  for (let row = 0; row < actual.length; row++) {
    assert.equal(actual[row].length, 1024); assert.equal(expected[row].length, 1024);
    let product = 0, leftNorm = 0, rightNorm = 0;
    for (let column = 0; column < 1024; column++) {
      const left = actual[row][column], right = expected[row][column];
      assert.equal(typeof left, 'number'); assert.equal(typeof right, 'number'); assert.ok(Number.isFinite(left) && Number.isFinite(right));
      maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(left - right));
      product += left * right; leftNorm += left * left; rightNorm += right * right;
    }
    assert.ok(Math.abs(Math.sqrt(leftNorm) - 1) <= tolerance && Math.abs(Math.sqrt(rightNorm) - 1) <= tolerance);
    minimumCosine = Math.min(minimumCosine, product / Math.sqrt(leftNorm * rightNorm));
  }
  return { rows: actual.length, dimensions: 1024, maxAbsoluteError, minimumCosine, tolerance };
};
export const compareDenseReferenceVectors = (actual, expected, tolerance) => {
  const result = measureDenseReferenceVectors(actual, expected, tolerance);
  assert.ok(result.maxAbsoluteError <= tolerance, 'independent raw-model maximum component error');
  assert.ok(result.minimumCosine >= 1 - tolerance, 'independent raw-model cosine agreement'); return result;
};
