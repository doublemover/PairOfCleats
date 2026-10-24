import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { embeddingArtifactPath } from '../../helpers/embedding-artifacts.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const checkout = process.cwd();
const { dir: root } = await prepareIsolatedTestCacheDir('ann-generation-rebuild');
const repo = path.join(root, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'sample.js'), 'export function uniqueGenerationWitness() { return 42; }\n');
const config = normalize => ({ indexing: { scm: { provider: 'none' },
  typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
  embeddings: { dims: 8, normalize, hnsw: { enabled: true, isolate: false }, lancedb: { enabled: true, isolate: false } } },
tooling: { autoEnableOnDetect: false, lsp: { enabled: false } } });
const env = normalize => applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'stub', testConfig: config(normalize),
  extraEnv: { POC_FIXTURE_ANN_ORIGINAL_RUNNER: process.env.POC_FIXTURE_ANN_ORIGINAL_RUNNER } });
const invoke = (args, label, childEnv) => runNode(args, label, repo, childEnv,
  { stdio: 'pipe', timeoutMs: 30000 });
const hook = pathToFileURL(path.join(checkout, 'tests/helpers/ann-writer-failure-hook.js')).href;
invoke([path.join(checkout, 'build_index.js'), '--repo', repo, '--mode', 'code', '--stage', 'stage1',
  '--stub-embeddings'], 'fresh stage1', env(true));
const sqliteBuild = await runSqliteBuild(repo, { mode: 'code', env: env(true), emitOutput: false });
assert.equal(sqliteBuild.ok, true);
const build = () => ['--import', hook, path.join(checkout, 'tools/build/embeddings.js'),
  '--repo', repo, '--mode', 'code', '--stub-embeddings'];
const originalBuild = invoke(build(), 'original native generation', env(true));
const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
const state = () => fs.readFile(path.join(indexDir, 'index_state.json'), 'utf8').then(JSON.parse);
const original = await state();
assert.equal(original.embeddings.backends.hnsw.available, true, `${originalBuild.stdout}\n${originalBuild.stderr}`);
assert.equal(original.embeddings.backends.lancedb.available, true);
const retained = [];
for (const name of ['dense_vectors_hnsw', 'dense_vectors_hnsw_meta', 'dense_vectors_lancedb_meta']) {
  const file = embeddingArtifactPath(indexDir, name);
  retained.push({ file, bytes: await fs.readFile(file) });
}
const failure = invoke(build(), 'changed normalization with native writer failure',
  { ...env(false), POC_FIXTURE_ANN_FAIL: '1' });
assert.match(`${failure.stdout}\n${failure.stderr}`, /fixture: native writer failure/, 'The production wrappers must observe the injected writer failures');
const failureOutput = `${failure.stdout}\n${failure.stderr}`;
assert.equal((failureOutput.match(/failed to write HNSW index: fixture: native writer failure/g) || []).length, 3);
assert.equal((failureOutput.match(/failed to write LanceDB index: fixture: native writer failure/g) || []).length, 3,
  'each merged/doc/code writer reports its own original failure');
const current = await state();
assert.equal(current.embeddings.embeddingIdentity.modelId, original.embeddings.embeddingIdentity.modelId);
assert.equal(current.embeddings.embeddingIdentity.dims, original.embeddings.embeddingIdentity.dims);
assert.equal(original.embeddings.embeddingIdentity.normalize, true);
assert.equal(current.embeddings.embeddingIdentity.normalize, false);
for (const backend of ['hnsw', 'lancedb']) {
  assert.equal(current.embeddings.backends[backend].enabled, true);
  assert.equal(current.embeddings.backends[backend].available, false,
    `${backend}: a failed replacement must not relabel retained old native bytes as ready`);
}
assert.equal(current.embeddings.ready, true, 'Current dense vectors still support retrieval');
assert.notEqual(current.embeddings.embeddingGeneration, original.embeddings.embeddingGeneration);
const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'pieces/manifest.json'), 'utf8'));
assert.equal(manifest.pieces.some(piece => /hnsw|lancedb/.test(piece.name)), false);
for (const entry of retained) assert.deepEqual(await fs.readFile(entry.file), entry.bytes,
  'Prior complete generation retains its original bytes and identity');
for (const backend of ['memory', 'sqlite']) {
  const result = invoke([path.join(checkout, 'search.js'), 'uniqueGenerationWitness', '--repo', repo,
    '--mode', 'code', '--backend', backend, '--no-ann', '--json'], `${backend} lexical fallback`, env(false));
  const payload = JSON.parse(result.stdout);
  assert.ok(JSON.stringify(payload).includes('sample.js'), `${backend}: meaningful lexical result survives failed native writers`);
}
const automatic = invoke([path.join(checkout, 'search.js'), 'uniqueGenerationWitness', '--repo', repo,
  '--mode', 'code', '--backend', 'memory', '--ann', '--ann-backend', 'auto', '--stats', '--json'],
'automatic ANN admission after writer faults', env(false));
const automaticPayload = JSON.parse(automatic.stdout);
assert.ok(JSON.stringify(automaticPayload).includes('sample.js'));
assert.equal(automaticPayload.stats.annHnsw.available.code, false);
assert.equal(automaticPayload.stats.annLance.available.code, false);
console.log('Real rebuild changes normalization at fixed model/dimensions; writer faults cannot relabel the retained native generation and both lexical backends remain usable.');
