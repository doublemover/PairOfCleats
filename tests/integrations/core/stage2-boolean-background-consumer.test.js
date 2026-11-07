import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { buildStage2Args } from '../../../src/integrations/core/args.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';

const route = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['queue', 'fallback'].includes(route));
const { dir } = await prepareIsolatedTestCacheDir(`stage2-boolean-${route}`);
const root = path.join(dir, 'repo'), queueDir = path.join(dir, 'queue'), reportPath = path.join(dir, 'child.json');
await fs.mkdir(root); await fs.writeFile(path.join(root, 'a.js'), 'export function a() { return 1; }');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const config = createFastIndexingTestConfig({
  quality: 'fast', threads: 1,
  indexing: { workerPool: { enabled: false, maxWorkers: 1 }, embeddings: { enabled: false, mode: 'off', queue: { dir: queueDir } },
    twoStage: { enabled: true, background: true, queue: route === 'queue' } }
});
await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify(config));
const child = fileURLToPath(new URL('../../helpers/stage2-ordering-child.js', import.meta.url));
const subprocessUrl = new URL('../../../src/shared/subprocess/runner.js', import.meta.url).href;
const capture = { children: [], args: [], reportPath }; globalThis.__stage2HandoffCapture = capture;
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/shared/subprocess/runner.js')) return { shortCircuit: true, format: 'module', source: `
    export * from ${JSON.stringify(subprocessUrl + '?real-handoff-process')};
    import {spawnSubprocess as run} from ${JSON.stringify(subprocessUrl + '?real-handoff-process')};
    export const spawnSubprocess=(command,args,options)=>{
      if(String(args?.[0]).endsWith('build_index.js') && args.includes('stage2')) {
        const capture=globalThis.__stage2HandoffCapture; capture.args.push(args.slice(1));
        const work=run(command,[${JSON.stringify(child)},capture.reportPath,...args.slice(1)],{...options,unref:false,
          stdio:['ignore','pipe','pipe'],captureStdout:true,captureStderr:true,rejectOnNonZeroExit:false});
        capture.children.push(work); return work;
      }
      return run(command,args,options);
    };` };
  return next(url, context);
} });
try {
  const { buildIndex } = await import('../../../src/integrations/core/build-index/index.js');
  const { getRepoCacheRoot } = await import('../../../src/shared/dict-utils.js');
  const rawArgv = ['--mode', 'code', '--threads', '1', '--no-sqlite', '--stub-embeddings=false',
    '--validate-ordering=true', '--cache-rebuild', '--scheduler=false', '--scm-provider', 'none'];
  const { argv } = parseBuildArgs(rawArgv);
  const parent = await buildIndex(root, { ...argv, rawArgv, log: () => {} });
  const pointerPath = path.join(getRepoCacheRoot(root), 'builds/current.json');
  const pointer = await fs.readFile(pointerPath);
  let job;
  if (route === 'queue') {
    assert.equal(parent.stage2.queued, true);
    const { loadQueue } = await import('../../../tools/service/queue.js');
    const queued = await loadQueue(queueDir, 'index'); assert.equal(queued.jobs.length, 1); job = queued.jobs[0];
    const { createJobExecutor } = await import('../../../tools/service/indexer-service/job-executor.js');
    const executor = createJobExecutor({ isEmbeddingsQueue: false, serviceExecutionMode: 'subprocess', daemonWorkerConfig: {},
      resolvedQueueName: 'index', embeddingExtraEnv: {}, toolRoot: process.cwd(), resolveRepoRuntimeEnv: () => ({ ...env }),
      completeNonRetriableFailure: async () => {} });
    const result = await executor.executeClaimedJob({ job, jobLifecycle: { registerPromise: promise => promise }, logPath: null });
    assert.equal(result.runResult.exitCode, 1);
  } else assert.equal(parent.stage2.background, true);
  assert.equal(capture.children.length, 1, 'one real background child is admitted');
  const processResult = await capture.children[0]; assert.equal(processResult.exitCode, 1);
  const rejected = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(rejected.argv['stub-embeddings'], false); assert.equal(rejected.argv['validate-ordering'], true);
  assert.equal(rejected.argv['cache-rebuild'], false); assert.equal(rejected.argv.scheduler, false);
  assert.equal(rejected.argv['scm-provider'], 'none');
  assert.equal(rejected.state.validationCalls, 1); assert.equal(rejected.state.control.ok, true,
    'malformed ordering is independently admitted only when the explicit check is absent');
  assert.equal(rejected.state.requested.ok, false); assert.ok(rejected.state.requested.issues.some(issue => issue.includes('ordering ledger mismatch')));
  assert.match(rejected.error.message, /validation failed/);
  assert.deepEqual(await fs.readFile(pointerPath), pointer, 'failed background ordering validation cannot promote a generation');
  assert.deepEqual(parseBuildArgs(capture.args[0]).argv['validate-ordering'], argv['validate-ordering']);
  if (job) assert.deepEqual(job.args, capture.args[0], 'the actual service consumer receives the persisted canonical args');
  // Same real child/validator with false is the discriminating positive. All
  // production build/promotion work remains enabled; only the requested flag differs.
  capture.reportPath = path.join(dir, 'positive-child.json');
  const { spawnSubprocess } = await import('../../../src/shared/subprocess/runner.js');
  const positiveArgs = buildStage2Args({ root, argv: { ...argv, 'validate-ordering': false }, rawArgv });
  const positive = await spawnSubprocess(process.execPath, [path.resolve('build_index.js'), ...positiveArgs], { env, rejectOnNonZeroExit: false });
  assert.equal(positive.exitCode, 0, positive.stderr);
  const admitted = JSON.parse(await fs.readFile(capture.reportPath, 'utf8'));
  assert.equal(admitted.argv['validate-ordering'], false); assert.equal(admitted.state.requested.ok, true);
  assert.ok(admitted.result); assert.notDeepEqual(await fs.readFile(pointerPath), pointer);
} finally {
  await Promise.allSettled(capture.children); hook.deregister(); delete globalThis.__stage2HandoffCapture;
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Actual ${route} Stage2 child preserves parsed flags and rejects malformed ordering before promotion.`);
