import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';
import { resolveEmbeddingArtifactIdentityAsync } from '../../../src/shared/embedding-artifact-lease.js';
import { resolveModelSetupReadiness } from '../../../tools/setup/model-readiness.js';

const { dir } = await prepareIsolatedTestCacheDir('download-selected-closure');
const modelId = 'fixture/selected', modelsDir = path.join(dir, 'models'), target = path.join(dir, 'relocated/renamed.onnx');
const source = [
  "import fs from 'node:fs'; import path from 'node:path'; export const env = {};",
  "const field = (number, data) => { const bytes = Buffer.from(data); return Buffer.concat([Buffer.from([number * 8 + 2, bytes.length]), bytes]); };",
  "const entry = (key, value) => field(13, Buffer.concat([field(1, key), field(2, value)]));",
  "const graph = field(7, field(5, Buffer.concat([entry('location', 'nested/weights.custom'), entry('length', '4'), Buffer.from([112, 1])])));",
  'export async function pipeline(task, modelId, options) {',
  "  if (options.dtype !== 'q8') throw new Error('wrong selected precision');",
  "  const root = path.join(options.cache_dir, modelId); fs.mkdirSync(path.join(root, 'onnx/nested'), { recursive: true });",
  "  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) fs.writeFileSync(path.join(root, file), '{}');",
  "  fs.writeFileSync(path.join(root, 'onnx/model.onnx'), Buffer.from([0x3a, 0]));",
  "  fs.writeFileSync(path.join(root, 'onnx/model_quantized.onnx'), graph);",
  "  fs.writeFileSync(path.join(root, 'onnx/nested/weights.custom'), Buffer.from('abcd'));",
  "  return { model: { config: { model_type: 'controlled' } }, dispose() {} };",
  '}',
  "export const ModelRegistry = { get_model_files: async () => ['config.json', 'onnx/model_quantized.onnx'] };"
].join('\n');
const shim = path.join(dir, 'record-selected-prefetch.mjs');
await fs.writeFile(shim, [
  "import { registerHooks } from 'node:module';",
  `const source = ${JSON.stringify(source)};`,
  "registerHooks({ resolve(specifier, context, next) { if (specifier === '@huggingface/transformers') return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }; return next(specifier, context); } });"
].join('\n'));
try {
  await fs.writeFile(path.join(dir, '.pairofcleats.json'), JSON.stringify({ models: { id: modelId, dir: modelsDir } }));
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'),
    extraEnv: { PAIROFCLEATS_MODELS_DIR: modelsDir, PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const result = runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/download/models.js'), '--repo', dir,
    '--onnx-path', target], 'selected q8 closure relocation without native/network inference', process.cwd(), env,
  { stdio: 'pipe', timeoutMs: 5000 });
  assert.equal(result.status, 0);
  const selected = resolveOnnxModelPath({ modelPath: target });
  assert.deepEqual(await fs.readFile(selected), await fs.readFile(path.join(modelsDir, modelId, 'onnx/model_quantized.onnx')));
  assert.equal(await fs.readFile(path.join(path.dirname(selected), 'nested/weights.custom'), 'utf8'), 'abcd');
  const readiness = resolveModelSetupReadiness({ root: dir, modelConfig: { id: modelId, dir: modelsDir } });
  assert.equal(readiness.present, true); assert.equal(readiness.assets['onnx/model_quantized.onnx'], path.join(modelsDir, modelId, 'onnx/model_quantized.onnx'));
  const artifact = await resolveEmbeddingArtifactIdentityAsync({ provider: 'xenova', modelId, modelsDir });
  assert(artifact.inventory.some(row => row.path === 'onnx/nested/weights.custom'));
  assert(!artifact.inventory.some(row => row.path === 'onnx/model.onnx'), 'unused fp32 sibling cannot replace or enlarge the q8 closure');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual downloader selected-precision graph relocation and exact generic closure controls authored; execution deferred.');
