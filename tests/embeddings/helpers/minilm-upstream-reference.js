import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTransformersResourceScope } from '../../../src/shared/embedding-transformers-resources.js';
import { preserveEmbeddingCleanupFailure } from '../../../src/shared/embedding-cache-lifetime.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

export const MINILM_REFERENCE_RECIPE = Object.freeze({
  id: 'minilm-raw-token-mask-mean-l2-v2', modelId: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', dimensions: 384,
  source: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2#usage-huggingface-transformers',
  exportSource: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2#usage-transformersjs',
  implementation: 'Direct upstream AutoTokenizer/AutoModel; independent scalar mask-weighted mean and L2 normalization. No pipeline, provider adapter, shared pooling or normalizer.',
  comparison: 'Match exact input batches and padding geometry; record cross-batch drift separately because dynamic quantization is per tensor.',
  quantizationSource: 'https://onnx.ai/onnx/operators/onnx__DynamicQuantizeLinear.html',
  limitation: 'Same pinned ONNX export and native runtime; not an independent PyTorch/export-conversion or retrieval-quality qualification.'
});
export const assertMiniLmReferenceManifest = manifest => {
  assert.equal(manifest.provider, 'xenova'); assert.equal(manifest.modelId, MINILM_REFERENCE_RECIPE.modelId);
  assert.equal(manifest.dimensions, 384); assert.equal(manifest.normalize, true);
  assert.equal(manifest.modelProfile ?? null, null); assert.equal(manifest.onnxConfig ?? null, null);
  assert.deepEqual(manifest.artifacts.filter(row => row.path.endsWith('.onnx')).map(row => row.path), ['onnx/model_quantized.onnx'],
    'This finite reference supports the acquired MiniLM q8 graph only; other exports/profiles require their own recipe.');
};
const tensorReceipt = tensor => {
  assert.ok(ArrayBuffer.isView(tensor.data));
  return { dtype: tensor.type, dimensions: [...tensor.dims], bytes: tensor.data.byteLength,
    sha256: createHash('sha256').update(Buffer.from(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength)).digest('hex') };
};
const adoptTensors = (scope, values, role) => {
  for (const value of Object.values(values)) if (value && Array.isArray(value.dims) && ArrayBuffer.isView(value.data)) scope.adopt(value, role);
};

/** A port of the author's raw-model recipe, independent of the product's
 * decoding/pooling/admission path. Only disposal and artifact ownership reuse
 * canonical owners; reference arithmetic does not call their numeric helpers.
 */
export const createMiniLmUpstreamReference = async ({ transformers, manifest, signal }) => {
  assertMiniLmReferenceManifest(manifest); throwIfAborted(signal);
  const lifetime = createTransformersResourceScope('actual MiniLM raw reference lifetime', { drainFailuresBeforeResources: true });
  const selection = { cache_dir: manifest.modelsDir, local_files_only: true };
  let tokenizer, model;
  try {
    const config = await transformers.AutoConfig.from_pretrained(manifest.modelId, selection);
    assert.equal(config.model_type, 'bert'); assert.equal(config.hidden_size, 384); assert.equal(config.max_position_embeddings, 512);
    throwIfAborted(signal);
    tokenizer = lifetime.adopt(await transformers.AutoTokenizer.from_pretrained(manifest.modelId, selection), 'actual reference tokenizer');
    throwIfAborted(signal);
    model = lifetime.adopt(await transformers.AutoModel.from_pretrained(manifest.modelId,
      { ...selection, config, dtype: 'q8', device: 'cpu',
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 } }), 'actual reference raw model');
    throwIfAborted(signal);
  } catch (error) {
    lifetime.retainFailure(error);
    try { await lifetime.close(); } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
  const embed = async texts => {
    assert.ok(Array.isArray(texts) && texts.length > 0 && texts.length <= 64);
    throwIfAborted(signal);
    const scope = createTransformersResourceScope('actual MiniLM raw inputs/outputs', { drainFailuresBeforeResources: true });
    let result, primary, hasPrimary = false;
    try {
      // Match the export's tokenizer policy, independently of product formatters.
      const input = await tokenizer(texts, { padding: true, truncation: true });
      adoptTensors(scope, input, 'actual reference token input'); throwIfAborted(signal);
      const output = await model(input);
      adoptTensors(scope, output, 'actual reference raw output'); throwIfAborted(signal);
      const hidden = output.last_hidden_state, mask = input.attention_mask;
      assert.ok(hidden && mask, 'Require raw last_hidden_state and the actual attention mask.');
      assert.equal(hidden.type, 'float32'); assert.ok(hidden.data instanceof Float32Array);
      assert.equal(hidden.dims.length, 3); assert.equal(mask.dims.length, 2);
      const [count, sequence, width] = hidden.dims;
      assert.equal(count, texts.length); assert.equal(width, 384);
      assert.ok(Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 512);
      assert.equal(hidden.data.length, count * sequence * width); assert.equal(mask.data.length, count * sequence);
      assert.deepEqual(mask.dims, [count, sequence]);
      const vectors = [], tokenCounts = [];
      for (let row = 0; row < count; row++) {
        throwIfAborted(signal);
        const sums = new Float64Array(width); let tokens = 0;
        for (let token = 0; token < sequence; token++) {
          const weight = Number(mask.data[row * sequence + token]); assert.ok(weight === 0 || weight === 1);
          tokens += weight;
          for (let column = 0; column < width; column++) {
            const value = hidden.data[(row * sequence + token) * width + column]; assert.ok(Number.isFinite(value));
            sums[column] += value * weight;
          }
        }
        assert.ok(tokens > 0); tokenCounts.push(tokens);
        let squared = 0;
        for (let column = 0; column < width; column++) { sums[column] /= tokens; squared += sums[column] * sums[column]; }
        assert.ok(Number.isFinite(squared) && squared > 0);
        const norm = Math.sqrt(squared), vector = new Float32Array(width);
        for (let column = 0; column < width; column++) vector[column] = sums[column] / norm;
        vectors.push(vector);
      }
      result = { vectors, tokenization: { inputIds: tensorReceipt(input.input_ids), attentionMask: tensorReceipt(mask), tokenCounts },
        rawOutput: { dtype: hidden.type, dimensions: [...hidden.dims], bytes: hidden.data.byteLength },
        outputBytes: count * width * 4 };
    } catch (error) { hasPrimary = true; primary = error; scope.retainFailure(error); }
    try { await scope.close(); } catch (cleanup) { throw hasPrimary ? preserveEmbeddingCleanupFailure(primary, cleanup) : cleanup; }
    if (hasPrimary) throw primary;
    throwIfAborted(signal); return result;
  };
  return { recipe: MINILM_REFERENCE_RECIPE, embed, close: () => lifetime.close() };
};

/** Numeric comparisons independently validate both operands before measuring
 * maximum component error and cosine agreement. No provider decoder is reused.
 */
export const measureMiniLmVectorDifference = (actual, expected, tolerance) => {
  assert.equal(actual.length, expected.length);
  let maxAbsoluteError = 0, minimumCosine = 1;
  for (let row = 0; row < actual.length; row++) {
    assert.equal(actual[row].length, 384); assert.equal(expected[row].length, 384);
    let product = 0, actualSquared = 0, expectedSquared = 0;
    for (let column = 0; column < 384; column++) {
      const left = actual[row][column], right = expected[row][column];
      assert.equal(typeof left, 'number'); assert.equal(typeof right, 'number');
      assert.ok(Number.isFinite(left) && Number.isFinite(right));
      maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(left - right));
      product += left * right; actualSquared += left * left; expectedSquared += right * right;
    }
    assert.ok(Math.abs(Math.sqrt(actualSquared) - 1) <= tolerance && Math.abs(Math.sqrt(expectedSquared) - 1) <= tolerance);
    const cosine = product / Math.sqrt(actualSquared * expectedSquared); minimumCosine = Math.min(minimumCosine, cosine);
  }
  return { rows: actual.length, dimensions: 384, maxAbsoluteError, minimumCosine, tolerance };
};

export const compareMiniLmReferenceVectors = (actual, expected, tolerance) => {
  const result = measureMiniLmVectorDifference(actual, expected, tolerance);
  assert.ok(result.minimumCosine >= 1 - tolerance, 'independent raw-model cosine agreement');
  assert.ok(result.maxAbsoluteError <= tolerance,
    `Independent raw-model maximum error ${result.maxAbsoluteError} exceeds ${tolerance}.`);
  return result;
};
