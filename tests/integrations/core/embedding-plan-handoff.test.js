#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runEmbeddingsStage } from '../../../src/integrations/core/build-index/stages.js';
import { resolveBuildInvocationArgs } from '../../../src/integrations/core/args.js';
import { loadQueue } from '../../../tools/service/queue.js';
import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';
import { parseBuildEmbeddingsArgs } from '../../../tools/build/embeddings/cli.js';
import { attachEmbeddingExecutionPlan, validateEmbeddingExecutionPlan } from '../../../src/shared/embedding-execution-plan.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-plan-handoff-'));
const repo = path.join(temp, 'repo');
const build = path.join(temp, 'build');
const queueDir = path.join(temp, 'queue');
const output = path.join(temp, 'capture.json');
const toolRoot = path.join(temp, 'tool');
const script = path.join(toolRoot, 'tools', 'build', 'embeddings.js');
await fs.mkdir(repo);
await fs.mkdir(path.join(build, 'index-code'), { recursive: true });
await fs.mkdir(path.dirname(script), { recursive: true });
const parserUrl = pathToFileURL(path.resolve('tools/build/embeddings/cli.js')).href;
await fs.writeFile(script, `const fs = await import('node:fs');
  const { parseBuildEmbeddingsArgs } = await import(${JSON.stringify(parserUrl)});
  const c = parseBuildEmbeddingsArgs();
  fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({argv:c.argv,model:c.modelId,dims:c.configuredDims,
    provider:c.embeddingProvider,normalize:c.embeddingsConfig.normalize,plan:c.executionPlan,rawThreads:c.envConfig.threads}));`);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(temp, 'cache'), embeddings: 'stub' });
const config = { models: { id: 'original-config-model' }, indexing: { embeddings: { normalize: false, mode: 'service' } } };
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(config));
const callerHook = () => {};
const callerObject = { retained: true };
const apiOptions = { model: 'parent-cli-model', dims: 16, threads: 1, scheduler: false,
  schedulerCpu: 1, schedulerIo: 2, schedulerMem: 3, schedulerStarvation: 400,
  schedulerLowResource: false, stubEmbeddings: true, log: callerHook, metadata: callerObject };
const { argv } = resolveBuildInvocationArgs(apiOptions);
assert.equal(argv.log, callerHook);
assert.equal(argv.metadata, callerObject);
assert.equal(argv['stub-embeddings'], true);
assert.deepEqual(Object.fromEntries(['cpu', 'io', 'mem', 'starvation', 'low-resource'].map(key => [key, argv[`scheduler-${key}`]])),
  { cpu: 1, io: 2, mem: 3, starvation: 400, 'low-resource': false });
const canonicalWins = resolveBuildInvocationArgs({ ...apiOptions, 'scheduler-cpu': 4, 'stub-embeddings': false }).argv;
assert.equal(canonicalWins['scheduler-cpu'], 4);
assert.equal(canonicalWins['stub-embeddings'], false);
assert.equal(resolveBuildInvocationArgs({ ...apiOptions, rawArgv: [], 'scheduler-cpu': 5 }).argv['scheduler-cpu'], 5);
const base = { root: repo, argv, embedModes: ['code'], userConfig: config, indexRoot: build,
  includeEmbeddings: true, overallProgressRef: {}, log: () => {}, repoCacheRoot: path.join(temp, 'repo-cache'),
  runtimeEnv: env, recordIndexMetric: () => {}, buildEmbeddingsPath: script };
try {
  await runEmbeddingsStage({ ...base, embeddingRuntime: { embeddingEnabled: true, embeddingService: false,
    useStubEmbeddings: true, resolvedEmbeddingMode: 'stub' } });
  const direct = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(direct.plan.repoRoot, toRealPathSync(repo));
  assert.equal(direct.plan.indexRoot, toRealPathSync(build));
  assert.equal(direct.model, 'parent-cli-model');
  assert.equal(direct.dims, 16);
  for (const key of ['threads', 'scheduler', 'scheduler-cpu', 'scheduler-io', 'scheduler-mem', 'scheduler-starvation', 'scheduler-low-resource']) {
    assert.equal(direct.argv[key], argv[key], key);
  }
  await runEmbeddingsStage({ ...base, embeddingRuntime: { embeddingEnabled: true, embeddingService: true,
    useStubEmbeddings: true, resolvedEmbeddingMode: 'service', queueDir } });
  const queue = await loadQueue(queueDir, 'embeddings');
  assert.equal(queue.jobs.length, 1);
  const job = queue.jobs[0];
  assert.equal(job.embeddingPlan.options.model, 'parent-cli-model');
  assert.equal(job.embeddingPlan.sources.model, 'cli.model');
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({
    models: { id: 'changed-after-submission' }, threads: 7,
    indexing: { embeddings: { provider: 'onnx', mode: 'off', normalize: true } }
  }));
  const failures = [];
  const executor = createJobExecutor({ isEmbeddingsQueue: true, serviceExecutionMode: 'subprocess',
    daemonWorkerConfig: {}, resolvedQueueName: 'embeddings', embeddingExtraEnv: {}, toolRoot,
    resolveRepoRuntimeEnv: () => ({ ...env, PAIROFCLEATS_THREADS: '9' }),
    completeNonRetriableFailure: async (_, error) => { failures.push(error); } });
  const result = await executor.executeClaimedJob({ job, jobLifecycle: { registerPromise: promise => promise }, logPath: null });
  assert.equal(result.runResult.exitCode, 0);
  assert.deepEqual(failures, []);
  const queued = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(queued.model, direct.model);
  assert.equal(queued.provider, direct.provider);
  assert.equal(queued.normalize, false);
  assert.equal(queued.argv.threads, 1);
  assert.equal(queued.plan.digest, job.embeddingPlan.digest);
  const missingJob = await executor.executeClaimedJob({ job: { ...job, embeddingPlan: null },
    jobLifecycle: { registerPromise: promise => promise }, logPath: null });
  assert.equal(missingJob.handled, true);
  assert.match(failures.at(-1), /missing required/);
  assert.throws(() => validateEmbeddingExecutionPlan({ ...job.embeddingPlan, indexRoot: temp }), /digest mismatch/);
  assert.throws(() => validateEmbeddingExecutionPlan(job.embeddingPlan, { root: repo, indexRoot: temp }), /root mismatch/);
  assert.throws(() => validateEmbeddingExecutionPlan(job.embeddingPlan, { root: temp, indexRoot: build }), /repository root mismatch/);
  const repoAlias = path.join(temp, 'repo-alias');
  await fs.symlink(repo, repoAlias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(validateEmbeddingExecutionPlan(job.embeddingPlan, { root: repoAlias, indexRoot: build }).digest, job.embeddingPlan.digest);
  const missing = attachEmbeddingExecutionPlan(env, job.embeddingPlan);
  const context = JSON.parse(missing.PAIROFCLEATS_OBSERVABILITY_CONTEXT);
  delete context.context.embeddingPlan;
  await withTemporaryEnv({ ...missing, PAIROFCLEATS_OBSERVABILITY_CONTEXT: JSON.stringify(context) }, async () => {
    assert.throws(() => parseBuildEmbeddingsArgs(['--repo', repo, '--mode', 'code', '--index-root', build]), /missing required plan/);
  });
  console.log('embedding plan child and queue handoff test passed');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
