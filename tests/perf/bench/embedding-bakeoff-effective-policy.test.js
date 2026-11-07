import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBakeoffExecutionPolicy } from '../../../tools/bench/embeddings/bakeoff-execution-policy.js';
import { resolveBakeoffFastPathDefaults } from '../../../tools/bench/embeddings/model-bakeoff-lib.js';
import { resolveEmbeddingSamplingConfig } from '../../../tools/build/embeddings/sampling.js';
import { projectEmbeddingSamplingObservation } from '../../../tools/build/embeddings/sampling-observation.js';
import { bakeoffGenerationObservation, bakeoffGenerationIdentity } from '../../../tools/bench/embeddings/evaluation-identity.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

applyTestEnv();
const root = process.cwd(), { dir } = await prepareTestCacheDir('embedding-bakeoff-effective-policy');
const script = path.join(root, 'tests/fixtures/bakeoff-execution-policy/child.js');
for (const file of ['a.txt', 'b.txt', 'c.txt']) await fs.writeFile(path.join(dir, file), 'owned text ' + file);
const inherited = { ...process.env, PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES: '7', PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED: 'inherited',
  PAIROFCLEATS_EMBEDDINGS: 'stub', UNRELATED_PRIVATE_TOKEN: 'never-serialize-bakeoff-secret' };
const configured = { indexing: { embeddings: { sampleFiles: 5, sampleSeed: 'configured' } } };
const fast = (rawArgs, fullRun = false, embeddingSampleFiles = Number.NaN) => resolveBakeoffFastPathDefaults({ rawArgs,
  fullRun, embeddingSampleFiles, embeddingSampleSeed: 'chosen', limit: Number.NaN, skipCompare: false, resume: true });
const policy = (defaults, baseEnv = inherited, stubRequested = true) => createBakeoffExecutionPolicy({ root, userConfig: configured,
  baseEnv, mode: 'code', embeddingSampleFiles: defaults.embeddingSampleFiles,
  embeddingSampleSeed: defaults.embeddingSampleSeed, stubRequested });
const zero = policy(fast(['--embedding-sample-files', '0'], false, 0));
const full = policy(fast(['--full-run'], true));
const positive = policy(fast(['--full-run', '--embedding-sample-files', '3', '--embedding-sample-seed', 'chosen'], true, 3));
const quick = policy(fast([]));
for (const selected of [zero, full]) {
  assert.equal(selected.env.PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES, '0');
  assert.equal(selected.receipt.effective.sampling.maxFiles, null);
  assert.equal(resolveEmbeddingSamplingConfig({ embeddingsConfig: configured.indexing.embeddings, env: getEnvConfig(selected.env) }).maxFiles, null);
}
assert.equal(positive.receipt.effective.sampling.maxFiles, 3); assert.equal(positive.receipt.effective.sampling.seed, 'chosen');
assert.equal(quick.receipt.effective.sampling.maxFiles, 50);
assert.equal(resolveEmbeddingSamplingConfig({ embeddingsConfig: configured.indexing.embeddings, env: getEnvConfig({}) }).maxFiles, 5,
  'absent normalized environment is not an explicit disabled zero');
assert.equal(policy(fast(['--embedding-sample-files', '0'], false, 0), { ...inherited, PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES: '99' }).receipt.effective.sampling.maxFiles, null);
assert.equal(JSON.stringify(zero).includes(inherited.UNRELATED_PRIVATE_TOKEN), false);
assert.throws(() => { zero.env.PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES = '7'; }, TypeError);

const run = async (selected, phase) => {
  const model = selected.forModel({ modelId: 'Xenova/bge-small-en-v1.5', cacheRoot: path.join(dir, 'model-cache') });
  assert.equal(model.execution.environment.PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES, selected.env.PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES);
  assert.equal(model.execution.options['stub-embeddings'], selected.receipt.effective.stubEmbeddings);
  assert.equal(JSON.stringify(model).includes(inherited.UNRELATED_PRIVATE_TOKEN), false);
  const args = [script, phase, dir];
  const child = await spawnSubprocess(process.execPath, phase === 'compare' ? selected.compareArgs(args) : args,
    { cwd: root, env: phase === 'compare' ? selected.env : model.env, timeoutMs: 5000, maxOutputBytes: 16 * 1024 });
  return JSON.parse(child.stdout);
};
for (const phase of ['build', 'eval', 'compare']) {
  const observed = await run(zero, phase);
  assert.equal(observed.phase, phase); assert.equal(observed.sampling.maxFiles, null);
  assert.deepEqual(observed.selectedFiles, ['a.txt', 'b.txt', 'c.txt']);
  assert.deepEqual(observed.vectorDimensions, [8, 8, 8]);
  assert.equal(observed.receipt.selectedFiles, 3); assert.equal(observed.receipt.eligibleFiles, 3);
  assert.equal(observed.receipt.completedChunks, 3); assert.equal(observed.receipt.fullCoverage, true);
}
const one = policy(fast(['--embedding-sample-files', '1'], false, 1));
const sampled = await run(one, 'build');
assert.equal(sampled.selectedFiles.length, 1); assert.ok(['a.txt', 'b.txt', 'c.txt'].includes(sampled.selectedFiles[0]));
assert.deepEqual(sampled.vectorDimensions, [8]); assert.equal(sampled.receipt.fullCoverage, false);
assert.equal(sampled.receipt.eligibleFiles, 3); assert.equal(sampled.receipt.selectedFiles, 1);
assert.match(sampled.receipt.selectedInputIdentity, /^sha256:[a-f0-9]{64}$/);
const retained = { embeddings: { ready: true, pending: false, embeddingGeneration: sampled.receipt.embeddingGeneration },
  extensions: { embeddingSampling: sampled.receipt } };
assert.equal(projectEmbeddingSamplingObservation(retained, 'code').fullCoverage, false,
  'a retained sampled index stays sampled when the new request asks for zero');
assert.equal(projectEmbeddingSamplingObservation({ embeddings: { ready: true } }, 'code').observation, 'unknown');
assert.equal(projectEmbeddingSamplingObservation({ ...retained, embeddings: { ...retained.embeddings, pending: true } }, 'code').observation, 'unknown');
assert.equal(projectEmbeddingSamplingObservation({ ...retained, embeddings: { ...retained.embeddings, embeddingGeneration: { fixture: 'other' } } }, 'code').observation, 'unknown');
const repoCacheRoot = path.join(dir, 'repo-cache'), buildId = 'sampling-generation', buildRoot = path.join(repoCacheRoot, 'builds', buildId);
await seedPublishedArtifacts({ buildRoot, buildId });
const statePath = path.join(buildRoot, 'index-code/index_state.json');
await fs.writeFile(statePath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code', ...retained }));
await fs.writeFile(path.join(repoCacheRoot, 'builds/current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  buildId, buildRoot: 'builds/' + buildId, buildRootsByMode: { code: 'builds/' + buildId } }));
const recorded = await bakeoffGenerationObservation(repoCacheRoot);
assert.equal(recorded.coverage.modes.code.fullCoverage, false);
assert.equal(recorded.coverage.modes.code.selectedFiles, 1);
assert.equal(await bakeoffGenerationIdentity(repoCacheRoot), recorded.identity);
const missingMode = await bakeoffGenerationObservation(repoCacheRoot, { requestedModes: ['code', 'prose'] });
assert.equal(missingMode.coverage.modes.prose.observation, 'unknown'); assert.equal(missingMode.identity, recorded.identity);
await fs.writeFile(statePath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code' }));
const legacy = await bakeoffGenerationObservation(repoCacheRoot);
assert.equal(legacy.coverage.modes.code.observation, 'unknown'); assert.notEqual(legacy.identity, recorded.identity);
const inheritedStub = policy(fast([]), inherited, false);
assert.equal(inheritedStub.receipt.effective.stubEmbeddings, true);
assert.ok(inheritedStub.compareArgs([]).includes('--stub-embeddings'));
const off = policy(fast([]), { ...inherited, PAIROFCLEATS_EMBEDDINGS: 'off' }, false);
assert.equal(off.receipt.effective.embeddingMode, 'off'); assert.equal(off.compareArgs([]).includes('--stub-embeddings'), false);
await assert.rejects(run(off, 'compare'), error => error.code === 'SUBPROCESS_FAILED',
  'the controlled child must refuse real/off provider execution');
console.log('Bakeoff profile, effective child sampling and embedding intent agree across build/eval/compare; retained coverage stays separate.');
