import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { resolveVersionedCacheRoot } from '../../../src/shared/cache-roots.js';
import { DEFAULT_MODEL_ID } from '../../../tools/shared/dict-utils.js';
import { withBakeoffCheckpoint } from '../../../tools/bench/embeddings/bakeoff-checkpoint.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';

const { dir } = await prepareIsolatedTestCacheDir('bakeoff-observed-resume'), repo = path.join(dir, 'repo');
await fs.mkdir(path.join(repo, 'src'), { recursive: true });
await fs.writeFile(path.join(repo, 'src/a.js'), 'export const independentFixture = 1;\n');
// This owner resolves the build script beneath its selected fixture repository.
// The observed-phase adapter below supplies the actual bounded inert child.
await fs.writeFile(path.join(repo, 'build_index.js'), "process.stderr.write('inert fixture build path; no provider work\\n');\n");
const dataset = [{ query: 'a', mode: 'code', relevant: [{ file: 'src/a.js' }] }];
const changedDataset = [{ query: 'different', mode: 'code', relevant: [{ file: 'src/b.js' }] }];
const datasetPath = path.join(dir, 'dataset.json'); await fs.writeFile(datasetPath, JSON.stringify(dataset));
const baseConfig = createFastIndexingTestConfig({ threads: 1, sqlite: { use: false }, indexing: { embeddings: { enabled: false, mode: 'off' } } });
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off', testConfig: baseConfig, syncProcess: false });
const baseArgs = ['tools/bench/embeddings/model-bakeoff.js', '--repo', repo, '--models', DEFAULT_MODEL_ID,
  '--cache-root', path.join(dir, 'campaign'), '--dataset', datasetPath, '--backend', 'memory', '--no-ann', '--top', '5', '--skip-compare', '--json'];
const invoke = (checkpoint, { control = null, runEnv = env, build = false, skipEval = false, failure = false } = {}) => {
  const preload = control ? pathToFileURL(path.resolve('tests/fixtures/benchmarks/bakeoff-observed-resume-preload.js')) : null;
  if (preload) preload.searchParams.set('control', pathToFileURL(control).href);
  const child = runNode([...(preload ? ['--import', preload.href] : []), ...baseArgs,
    '--checkpoint', checkpoint, ...(!build ? ['--no-build'] : []), ...(skipEval ? ['--skip-eval'] : [])],
  'actual controller with independently specified inert eval children', process.cwd(), runEnv,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(child.status === 0, !failure, child.stderr || child.stdout);
  return child.stdout.trim() ? JSON.parse(child.stdout) : null;
};
try {
  const skeleton = invoke(path.join(dir, 'skeleton.json'), { skipEval: true });
  const repoCacheRoot = path.join(resolveVersionedCacheRoot(skeleton.models[0].cacheRoot), 'repos', skeleton.repo.repoId);
  for (const buildId of ['generation-a', 'generation-b']) {
    const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
    await seedPublishedArtifacts({ buildRoot, buildId });
    await fs.writeFile(path.join(buildRoot, 'index-code/index_state.json'), JSON.stringify({
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code', profile: { id: 'fixture-default' } }));
  }
  const selectA = () => atomicWriteJson(path.join(repoCacheRoot, 'builds/current.json'), {
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'generation-a', buildRoot: 'builds/generation-a', buildRootsByMode: { code: 'builds/generation-a' } });
  const setup = async (name, mutation) => {
    await selectA(); await fs.writeFile(datasetPath, JSON.stringify(dataset));
    const root = path.join(dir, name); await fs.mkdir(root);
    const control = { repoCacheRoot, dataset: datasetPath, changedDataset, mutation, counter: path.join(root, 'eval.count'),
      heldMarker: path.join(root, 'held-build.witness'), publishedMarker: path.join(root, 'publication.witness') };
    const controlPath = path.join(root, 'control.json'); await fs.writeFile(controlPath, JSON.stringify(control));
    return { root, control, controlPath, checkpoint: path.join(root, 'checkpoint.json') };
  };
  const publication = await setup('publication', 'publication');
  const first = invoke(publication.checkpoint, { control: publication.controlPath });
  assert.equal(first.models[0].eval.mrr, 1);
  assert.equal(first.models[0].eval.executionEvidence.receipts[0].receipt.generations.code.buildId, 'generation-a');
  assert.equal(first.models[0].resumeIdentity.generation, null, 'the actual controller cannot stamp later B onto A metrics');
  assert.match(await fs.readFile(publication.control.publishedMarker, 'utf8'), /after A child returned/);
  const underB = invoke(publication.checkpoint, { control: publication.controlPath });
  assert.equal(underB.progress.resumedModels, 0);
  assert.equal(underB.models[0].eval.executionEvidence.receipts[0].receipt.generations.code.buildId, 'generation-b');
  const unchanged = invoke(publication.checkpoint, { control: publication.controlPath });
  assert.equal(unchanged.progress.resumedModels, 1);
  assert.equal(await fs.readFile(publication.control.counter, 'utf8'), '2');

  const policy = await setup('query-policy', 'none');
  const original = invoke(policy.checkpoint, { control: policy.controlPath });
  const changedEnv = { ...env, PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ ...baseConfig, search: { fieldWeights: { name: 9 } } }) };
  const changed = invoke(policy.checkpoint, { control: policy.controlPath, runEnv: changedEnv });
  assert.equal(changed.progress.resumedModels, 0);
  assert.equal(changed.progress.resume.state, 'compatible-partial');
  assert.equal(changed.progress.resume.excludedModels[0].reason, 'effective-evaluation-query-plan-changed-or-unknown');
  assert.equal(changed.models[0].resumeIdentity.generation, original.models[0].resumeIdentity.generation);
  assert.notEqual(changed.models[0].eval.evaluationSearchPlan.key, original.models[0].eval.evaluationSearchPlan.key);
  const stable = invoke(policy.checkpoint, { control: policy.controlPath, runEnv: changedEnv });
  assert.equal(stable.progress.resumedModels, 1); assert.equal(await fs.readFile(policy.control.counter, 'utf8'), '2');
  const legacyPath = path.join(policy.root, 'legacy.json'), legacy = structuredClone(stable);
  delete legacy.models[0].eval.evaluationSearchPlan;
  await withBakeoffCheckpoint({ root: process.cwd(), checkpointPath: legacyPath,
    receiptRoot: path.join(policy.root, 'legacy-receipts'), settings: stable.settings }, owner => owner.write(legacy, { final: true }));
  const legacyRun = invoke(legacyPath, { control: policy.controlPath, runEnv: changedEnv });
  assert.equal(legacyRun.progress.resumedModels, 0);
  assert.equal(legacyRun.progress.resume.excludedModels[0].reason, 'effective-evaluation-query-plan-changed-or-unknown');

  const held = await setup('held-dataset', 'dataset-held');
  invoke(held.checkpoint, { control: held.controlPath, build: true, failure: true });
  assert.match(await fs.readFile(held.control.heldMarker, 'utf8'), /while the original child remained pending/);
  const refused = JSON.parse(await fs.readFile(held.checkpoint, 'utf8'));
  assert.equal(refused.progress.status, 'failed'); assert.equal(refused.models.length, 0);
  assert.equal(refused.progress.phases.some(row => row.phase === 'eval' && row.state === 'failed'), true);
  await fs.unlink(datasetPath);
  const before = await fs.readFile(policy.checkpoint, 'utf8');
  invoke(policy.checkpoint, { control: policy.controlPath, failure: true });
  assert.equal(await fs.readFile(policy.checkpoint, 'utf8'), before, 'missing input cannot relabel or replace a prior complete checkpoint');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual bakeoff controller/checkpoints bind independently specified inert eval receipts to selected input, policy and generation; no native model or corpus qualification is claimed.');
