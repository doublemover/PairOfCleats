import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { toNativeFilePath } from '../../../src/shared/file-paths.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { resolveInstalledOnnxPath, readOnnxInstallationReceipt, onnxSelectionPath,
  ONNX_INSTALLATION_RECEIPT } from '../../../src/shared/onnx-installation.js';
import { createOnnxResourceOwner } from '../../../src/shared/onnx-embeddings/resource-lifetime.js';
import { withOnnxTensorScope } from '../../../src/shared/onnx-embeddings/tensor-lifetime.js';
import { preserveEmbeddingCleanupFailure } from '../../../src/shared/embedding-cache-lifetime.js';

export const DIRECT_MINILM_ARTIFACTS = Object.freeze([
  { path: 'tokenizer/config.json', bytes: 650, sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7' },
  { path: 'tokenizer/tokenizer.json', bytes: 711661, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  { path: 'tokenizer/tokenizer_config.json', bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  { path: 'weights/model_quantized.onnx', bytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' }
].map(Object.freeze));
export const DIRECT_MINILM_REFERENCE_RECIPE = Object.freeze({
  id: 'direct-minilm-root-ort-mask-mean-l2-v1', modelId: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', dimensions: 384,
  runtime: '4.3.2', nativeRuntime: '1.30.0', output: 'last_hidden_state',
  source: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2#usage-huggingface-transformers',
  exportSource: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2#usage-transformersjs',
  implementation: 'Raw AutoTokenizer and root ORT InferenceSession; independent feeds, scalar mask mean and L2; no production tokenizer batching, decoding or numeric helper.',
  comparison: 'Strict1e-5 with matching input/padding/batch geometry; dynamic-quantization cross-shape drift remains descriptive.',
  prepared: 'Public prepare/embedPrepared unsupported by direct ONNX provider; internal token-row reuse is a separate optimization.',
  limitation: 'Same content-pinned ONNX export/native runtime; no independent PyTorch conversion, judged quality or old/current performance claim.'
});
export const directMiniLmSessionOptions = () => ({ executionProviders: [{ name: 'cpu', useArena: false }],
  intraOpNumThreads: 1, interOpNumThreads: 1, graphOptimizationLevel: 'basic',
  enableCpuMemArena: false, enableMemPattern: false, executionMode: 'sequential' });
export const assertDirectMiniLmManifest = manifest => {
  assert.equal(manifest.modelId, DIRECT_MINILM_REFERENCE_RECIPE.modelId); assert.equal(manifest.provider, 'onnx');
  assert.equal(manifest.dimensions, 384); assert.equal(manifest.normalize, true); assert.equal(manifest.tolerance, 1e-5);
  assert.equal(manifest.modelProfile ?? null, null);
  assert.deepEqual(manifest.runtime, { transformers: '4.3.2', onnxruntimeNode: '1.30.0' });
  assert.deepEqual(manifest.providerRuntime, { name: 'onnxruntime-node', version: '1.30.0' });
  assert.ok(path.isAbsolute(manifest.modelsDir)); assert.ok(path.isAbsolute(manifest.onnxConfig?.modelPath));
  assert.equal(path.basename(manifest.onnxConfig.modelPath), 'model_quantized.onnx');
  assert.deepEqual(manifest.onnxConfig, { modelPath: manifest.onnxConfig.modelPath, tokenizerId: manifest.modelId,
    executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1,
    graphOptimizationLevel: 'basic', cpuExecutionProviderTuning: true });
  assert.deepEqual([...manifest.artifacts].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), DIRECT_MINILM_ARTIFACTS);
};
export const assertDirectMiniLmRoute = route => {
  assert.notEqual(route, 'prepared', 'Direct ONNX has no public prepare/embedPrepared capability; actual EG2 Xenova qualification owns that supported route.');
};
export const readDirectMiniLmInstallation = async ({ manifest, selectedGraph, signal }) => {
  assertDirectMiniLmManifest(manifest); throwIfAborted(signal);
  assert.equal(resolveInstalledOnnxPath(manifest.onnxConfig.modelPath), selectedGraph,
    'Direct actual qualification requires the original verified installation selector, not a neighboring graph.');
  const root = path.dirname(selectedGraph), installation = readOnnxInstallationReceipt(root);
  assert.equal(installation.graph, 'model_quantized.onnx');
  assert.deepEqual(installation.files, DIRECT_MINILM_ARTIFACTS.filter(row => row.path.startsWith('weights/'))
    .map(row => ({ ...row, path: row.path.slice('weights/'.length) })));
  const record = async filename => {
    const read = await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: 65536, hashAlgorithm: 'sha256', signal });
    return { path: filename, sha256: read.hash };
  };
  return { target: manifest.onnxConfig.modelPath, selectedGraph, closureDigest: installation.digest, files: installation.files,
    selector: await record(onnxSelectionPath(manifest.onnxConfig.modelPath)), receipt: await record(path.join(root, ONNX_INSTALLATION_RECEIPT)) };
};
const tensorReceipt = tensor => ({ dtype: tensor.type, dimensions: [...tensor.dims], bytes: tensor.data.byteLength,
  sha256: createHash('sha256').update(Buffer.from(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength)).digest('hex') });

export const scalarDirectMiniLmReference = ({ hidden, mask, count, signal }) => {
  assert.equal(hidden?.type, 'float32'); assert.ok(hidden.data instanceof Float32Array); assert.equal(hidden.dims.length, 3);
  const [rows, sequence, width] = hidden.dims;
  assert.equal(rows, count); assert.equal(width, 384); assert.ok(Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 512);
  assert.equal(hidden.data.length, count * sequence * width);
  assert.equal(mask.type, 'int64'); assert.ok(mask.data instanceof BigInt64Array);
  assert.deepEqual(mask.dims, [count, sequence]); assert.equal(mask.data.length, count * sequence);
  const vectors = [], tokenCounts = [];
  for (let row = 0; row < count; row++) {
    throwIfAborted(signal); const sums = new Float64Array(width); let tokens = 0;
    for (let token = 0; token < sequence; token++) {
      const weight = mask.data[row * sequence + token]; assert.ok(weight === 0n || weight === 1n); tokens += Number(weight);
      for (let column = 0; column < width; column++) {
        const value = hidden.data[(row * sequence + token) * width + column]; assert.ok(Number.isFinite(value));
        sums[column] += value * Number(weight);
      }
    }
    assert.ok(tokens > 0); tokenCounts.push(tokens); let squared = 0;
    for (let column = 0; column < width; column++) { sums[column] /= tokens; squared += sums[column] * sums[column]; }
    assert.ok(Number.isFinite(squared) && squared > 0); const vector = new Float32Array(width), norm = Math.sqrt(squared);
    for (let column = 0; column < width; column++) vector[column] = sums[column] / norm;
    vectors.push(vector);
  }
  return { vectors, tokenCounts };
};

// The manual caller supplies its original verified lease's selectedGraph.
// runtime injection belongs only to deterministic component/cleanup controls.
export const createDirectMiniLmReference = async ({ transformers, manifest, selectedGraph, signal, runtime = null }) => {
  assertDirectMiniLmManifest(manifest); assert.ok(path.isAbsolute(selectedGraph)); throwIfAborted(signal);
  const entry = { tensorScopes: new Set(), operationFailure: null }, operations = new Set();
  let tokenizer = null, session = null, owner = null, Tensor, disposed = false, closing = null;
  try {
    const selection = { cache_dir: manifest.modelsDir, local_files_only: true };
    const config = await transformers.AutoConfig.from_pretrained(manifest.modelId, selection);
    assert.equal(config.model_type, 'bert'); assert.equal(config.hidden_size, 384); assert.equal(config.max_position_embeddings, 512);
    throwIfAborted(signal);
    tokenizer = await transformers.AutoTokenizer.from_pretrained(manifest.modelId, selection); throwIfAborted(signal);
    assert.equal(typeof tokenizer, 'function'); assert.equal(tokenizer.pad_token_id, 0);
    const native = runtime || await import('onnxruntime-node'); Tensor = native.Tensor;
    session = await native.InferenceSession.create(toNativeFilePath(selectedGraph), directMiniLmSessionOptions());
    owner = createOnnxResourceOwner({ session, tokenizer, tensorScopes: entry.tensorScopes }); throwIfAborted(signal);
    assert.deepEqual([...session.inputNames].sort(), ['attention_mask', 'input_ids', 'token_type_ids']);
    assert.deepEqual(session.outputNames, ['last_hidden_state']);
  } catch (error) {
    owner ||= createOnnxResourceOwner({ session, tokenizer, tensorScopes: entry.tensorScopes }); owner.retainOperationFailure(error);
    try { await owner.release(); } catch (cleanup) { throw preserveEmbeddingCleanupFailure(error, cleanup); }
    throw error;
  }
  const embed = texts => {
    if (disposed) return Promise.reject(new Error('Direct MiniLM raw reference is closed.'));
    const work = withOnnxTensorScope(entry, async scope => {
      throwIfAborted(signal); assert.ok(Array.isArray(texts) && texts.length > 0 && texts.length <= 64);
      const encoded = await tokenizer(texts, { padding: true, truncation: true, return_tensor: false, return_token_type_ids: true });
      throwIfAborted(signal); const feeds = {}, count = texts.length;
      const sequence = encoded.input_ids[0].length; assert.ok(Number.isSafeInteger(sequence) && sequence > 0 && sequence <= 512);
      for (const name of ['input_ids', 'attention_mask', 'token_type_ids']) {
        assert.equal(encoded[name].length, count); const values = new BigInt64Array(count * sequence);
        for (let row = 0; row < count; row++) {
          assert.equal(encoded[name][row].length, sequence);
          for (let column = 0; column < sequence; column++) {
            const value = encoded[name][row][column]; assert.ok(Number.isSafeInteger(value) && value >= 0);
            if (name === 'attention_mask') assert.ok(value === 0 || value === 1);
            values[row * sequence + column] = BigInt(value);
          }
        }
        feeds[name] = scope.adopt(new Tensor('int64', values, [count, sequence]), 'raw direct ONNX input');
      }
      throwIfAborted(signal); const outputs = await session.run(feeds, ['last_hidden_state']);
      for (const tensor of Object.values(outputs)) scope.adopt(tensor, 'raw direct ONNX output');
      throwIfAborted(signal);
      const { vectors, tokenCounts } = scalarDirectMiniLmReference({ hidden: outputs.last_hidden_state, mask: feeds.attention_mask, count, signal });
      return { vectors, tokenization: { inputIds: tensorReceipt(feeds.input_ids), attentionMask: tensorReceipt(feeds.attention_mask),
        tokenTypeIds: tensorReceipt(feeds.token_type_ids), tokenCounts },
      rawOutput: { dtype: outputs.last_hidden_state.type, dimensions: [...outputs.last_hidden_state.dims], bytes: outputs.last_hidden_state.data.byteLength },
      outputBytes: count * 384 * 4 };
    }, () => owner.retainOperationFailure(entry.operationFailure));
    operations.add(work); work.then(() => operations.delete(work), error => { operations.delete(work); owner.retainOperationFailure(error); });
    return work;
  };
  return { recipe: DIRECT_MINILM_REFERENCE_RECIPE, embed, close() {
    disposed = true;
    closing ||= Promise.allSettled([...operations]).then(() => owner.release()).catch(error => { closing = null; throw error; });
    return closing;
  } };
};
