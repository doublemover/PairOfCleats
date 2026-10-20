import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { DEFAULT_MODEL_ID } from '../../../tools/shared/dict-utils.js';

const { dir } = await prepareIsolatedTestCacheDir('download-model-selection');
const shim = path.join(dir, 'record-pipeline.mjs'), calls = path.join(dir, 'pipeline.json');
await fs.writeFile(shim, [
  "import { registerHooks } from 'node:module';",
  "const source = `import fs from 'node:fs'; export const env = {}; export async function pipeline(task, model, options) { fs.writeFileSync(process.env.POC_MODEL_SELECTION_RECEIPT, JSON.stringify({ task, model, options, cacheDir: env.cacheDir })); }`;",
  "registerHooks({ resolve(specifier, context, next) { if(specifier === '@huggingface/transformers') return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }; return next(specifier, context); } });"
].join('\n'));
const cases = [
  [{ indexing: { embeddings: { model: 'fixture/indexing-model' } }, models: { id: 'fixture/legacy-model' } }, [], 'fixture/indexing-model'],
  [{ models: { id: 'fixture/legacy-model' } }, [], 'fixture/legacy-model'],
  [{ indexing: { embeddings: { model: 'fixture/indexing-model' } }, models: { id: 'fixture/legacy-model' } }, ['--model', 'fixture/explicit-model'], 'fixture/explicit-model'],
  [{}, [], DEFAULT_MODEL_ID]
];
try {
  for (const [config, args, expected] of cases) {
    await fs.writeFile(path.join(dir, '.pairofcleats.json'), JSON.stringify(config));
    const cacheRoot = path.join(dir, 'cache');
    const env = applyTestEnv({ syncProcess: false, cacheRoot,
      extraEnv: { POC_MODEL_SELECTION_RECEIPT: calls, PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
    runNode(['--import', pathToFileURL(shim).href, path.resolve('tools/download/models.js'), '--repo', dir, ...args],
      'record selected model without network/provider loading', process.cwd(), env, { stdio: 'pipe', timeoutMs: 5000 });
    const recorded = JSON.parse(await fs.readFile(calls, 'utf8'));
    assert.equal(recorded.model, expected);
    assert.equal(recorded.task, 'feature-extraction');
    assert.equal(recorded.options.dtype, 'q8');
    assert.equal(recorded.cacheDir, path.join(cacheRoot, 'models'));
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Model prefetch selects explicit, indexing, legacy and default identities through a recording pipeline');
