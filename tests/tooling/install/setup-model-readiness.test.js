import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('setup-model-readiness');
const shim = path.join(dir, 'controlled-model-download.mjs');
const calls = path.join(dir, 'download.json');
await fs.writeFile(shim, [
  "import fs from 'node:fs'; import childProcess from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const original = childProcess.spawnSync;',
  'childProcess.spawnSync = function(command, args, options) {',
  "  if (args.some(arg => String(arg).replaceAll('\\\\', '/').endsWith('/tools/download/models.js'))) {",
  '    fs.writeFileSync(process.env.POC_MODEL_READINESS_CALLS, JSON.stringify(args));',
  "    return { status: 1, signal: null, stdout: '', stderr: 'controlled unavailable download' };",
  '  } return original(command, args, options); }; syncBuiltinESMExports();'
].join('\n'));
const writeAssets = async (root, files) => {
  for (const [file, bytes] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), bytes);
  }
};
const fullAssets = { 'config.json': '{}', 'tokenizer.json': '{}', 'tokenizer_config.json': '{}', 'onnx/model_quantized.onnx': 'fixture weights' };
const cases = [
  { id: 'other-model', assets: { 'fixture/model-a': fullAssets }, present: false, partial: false },
  { id: 'stray-file', assets: { 'unrelated': { 'notes.txt': 'not model assets' } }, present: false, partial: false },
  { id: 'empty-directory', assets: {}, present: false, partial: false },
  { id: 'partial-model', assets: { 'fixture/model-b': { 'config.json': '{}' } }, present: false, partial: true },
  { id: 'empty-weights', assets: { 'fixture/model-b': { ...fullAssets, 'onnx/model_quantized.onnx': '' } }, present: false, partial: true },
  { id: 'selected-model', assets: { 'fixture/model-b': fullAssets }, present: true, partial: false },
  { id: 'onnx-selected', assets: { 'fixture/tokenizer': fullAssets }, onnx: { modelPath: 'weights/custom.onnx', tokenizerId: 'fixture/tokenizer' }, weight: 'fixture onnx bytes', present: true, partial: false },
  { id: 'onnx-missing', assets: { 'fixture/tokenizer': fullAssets }, onnx: { modelPath: 'weights/missing.onnx', tokenizerId: 'fixture/tokenizer' }, present: false, partial: true }
];
try {
  for (const entry of cases) {
    const repo = path.join(dir, entry.id), modelsDir = path.join(repo, 'models');
    await fs.mkdir(path.join(modelsDir, 'unrelated-empty'), { recursive: true });
    for (const [name, files] of Object.entries(entry.assets)) await writeAssets(path.join(modelsDir, name), files);
    if (entry.weight) await writeAssets(repo, { [entry.onnx.modelPath]: entry.weight });
    await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ models: { id: 'fixture/model-b', dir: modelsDir },
      indexing: { embeddings: { provider: entry.onnx ? 'onnx' : 'xenova', ...(entry.onnx ? { onnx: entry.onnx } : {}) } } }));
    await fs.rm(calls, { force: true });
    const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(repo, 'cache'),
      extraEnv: { POC_MODEL_READINESS_CALLS: calls, PAIROFCLEATS_MODELS_DIR: modelsDir,
        PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
    const result = runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/setup/setup.js'), '--root', repo,
      '--json', '--non-interactive', '--require-steps', 'models', '--skip-install', '--skip-validate', '--skip-dicts',
      '--skip-extensions', '--skip-tooling', '--skip-index', '--skip-sqlite', '--skip-artifacts'],
    entry.id, process.cwd(), env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    const receipt = JSON.parse(result.stdout);
    assert.equal(result.status, entry.present ? 0 : 1, `${entry.id}: selected model controls readiness; ${result.stderr}`);
    const model = receipt.steps.models;
    assert.equal(model.present, entry.present, entry.id);
    assert.equal(model.modelId, 'fixture/model-b');
    assert.equal(model.provider, entry.onnx ? 'onnx' : 'xenova');
    assert.equal(model.partial, entry.partial, entry.id);
    assert.equal(model.verificationLevel, entry.present ? 'nonempty-readable-selected-assets' : null);
    assert.equal(await fs.stat(calls).then(() => true, () => false), !entry.present, 'download boundary is exercised only for missing selected assets');
    if (!entry.present) {
      assert.ok(model.missing.length > 0);
      const invocation = JSON.parse(await fs.readFile(calls, 'utf8'));
      assert.equal(invocation[invocation.indexOf('--model') + 1], 'fixture/model-b');
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Setup requires selected provider weights and tokenizer assets, without claiming inference qualification');
