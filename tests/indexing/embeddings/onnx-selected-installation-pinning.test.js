import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { getEmbeddingAdapter, disposeEmbeddingAdapterCaches } from '../../../src/shared/embedding-adapter.js';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { ONNX_INSTALLATION_RECEIPT, onnxSelectionPath } from '../../../src/shared/onnx-installation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('onnx-selected-installation-pinning');
const target = path.join(dir, 'selected.onnx'), modelId = 'fixture/tokenizer', loads = [], adapters = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const installation = async (name, bytes) => {
  const root = path.join(`${target}.assets`, name), graph = path.join(root, 'selected.onnx');
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(graph, bytes);
  const files = [{ path: 'selected.onnx', bytes: bytes.length, sha256: sha(bytes) }], digest = sha(JSON.stringify(files));
  await fs.writeFile(path.join(root, ONNX_INSTALLATION_RECEIPT), JSON.stringify({ version: 1, graph: 'selected.onnx', files, digest }));
  return { graph, selection: { version: 1, graph: `${path.basename(target)}.assets/${name}/selected.onnx`, digest } };
};
const originalOpen = fs.open;
let release = () => {};
globalThis.__selectedOnnxInstallation = {
  AutoTokenizer: { from_pretrained: async () => texts => ({ input_ids: texts.map(() => [1]), attention_mask: texts.map(() => [1]) }) },
  Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } dispose() {} },
  InferenceSession: { create: async modelPath => {
    const load = { modelPath, releases: 0 }; loads.push(load);
    return { inputNames: ['input_ids', 'attention_mask'], outputNames: ['sentence_embedding'],
      outputMetadata: [{ name: 'sentence_embedding', isTensor: true, type: 'float32', shape: ['batch', 2] }],
      run: async feeds => ({ sentence_embedding: { type: 'float32', data: new Float32Array(feeds.input_ids.dims[0] * 2).fill(1), dims: [feeds.input_ids.dims[0], 2] } }),
      release() { load.releases++; } };
  } }
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (['onnxruntime-node', '@huggingface/transformers'].includes(specifier)) return { url: `selected-installation:${specifier}`, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith('selected-installation:')) return { format: 'module', shortCircuit: true,
    source: 'export const { AutoTokenizer, Tensor, InferenceSession } = globalThis.__selectedOnnxInstallation;' };
  return next(url, context);
} });
try {
  await fs.mkdir(path.join(dir, modelId), { recursive: true }); await fs.writeFile(path.join(dir, modelId, 'tokenizer.json'), '{}');
  const old = await installation('old', Buffer.from('old inert graph')), next = await installation('new', Buffer.from('new inert graph'));
  for (const kind of ['cached-public-adapter', 'direct-onnx-adapter']) {
    await fs.writeFile(onnxSelectionPath(target), JSON.stringify(old.selection));
    let entered;
    const reading = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    let gated = false;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (String(file) === old.graph && !gated) {
        gated = true; const read = handle.read.bind(handle);
        handle.read = async (...readArgs) => { entered(); await gate; return read(...readArgs); };
      }
      return handle;
    };
    const options = { rootDir: dir, modelsDir: dir, modelId, onnxConfig: { modelPath: target } };
    const adapter = kind === 'cached-public-adapter' ? getEmbeddingAdapter({ ...options, provider: 'onnx' }) : createOnnxEmbedder(options);
    adapters.push(adapter);
    const work = kind === 'cached-public-adapter' ? adapter.embed(['selected request']) : adapter.getEmbeddings(['selected request']);
    await reading; await fs.writeFile(onnxSelectionPath(target), JSON.stringify(next.selection)); release();
    assert.equal((await work).length, 1);
    assert.equal(loads.at(-1).modelPath, old.graph, `${kind} must initialize its verified installation even after selector replacement`);
    assert.equal(await fs.readFile(old.graph, 'utf8'), 'old inert graph');
    fs.open = originalOpen; await adapter.dispose(); await disposeEmbeddingAdapterCaches();
    assert.equal(loads.at(-1).releases, 1);
  }
} finally {
  release(); fs.open = originalOpen; await Promise.allSettled(adapters.map(adapter => adapter.dispose()));
  await disposeEmbeddingAdapterCaches(); hooks.deregister(); delete globalThis.__selectedOnnxInstallation;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual public/direct ONNX consumers retain verified physical installation through mutable selector replacement; execution deferred.');
