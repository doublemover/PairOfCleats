import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createRuntimeAttempt } from '../../../src/shared/runtime-envelope/receipt.js';
import { persistRuntimeAttempt } from '../../../src/index/build/build-state/runtime.js';
import { withRuntimeBindingObserver } from '../../../src/shared/runtime-envelope/execution-binding.js';
import { initializeRuntimeReceipt } from '../../../src/index/build/runtime/receipt.js';
import { createJobExecutor } from '../../../tools/service/indexer-service/job-executor.js';
import { bindClaimedJobExecution } from '../../../tools/service/indexer-service/queue-worker.js';
import { startBuildProgressMonitor } from '../../../tools/service/indexer-service/progress-monitor.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('service-executor-binding');
const repo = path.join(dir, 'repo'), toolRoot = path.join(dir, 'tools');
await fs.mkdir(repo); await fs.mkdir(toolRoot);
const entered = Promise.withResolvers(), release = Promise.withResolvers(), observed = [];
const attempt = await createRuntimeAttempt({ buildId: 'durability-control', stage: 'stage2',
  observability: { correlation: { correlationId: 'durability-control' } }, paths: { repo } });
const pending = withRuntimeBindingObserver(value => observed.push(value), async () => {
  await persistRuntimeAttempt(dir, attempt, {}, { write: async () => { entered.resolve(); await release.promise; } });
  await persistRuntimeAttempt(dir, attempt, { lifecycle: 'running' }, { write: async () => {} });
});
await entered.promise;
assert.equal(observed.length, 0, 'a selected path or pending write is not a durable executor binding');
release.resolve(); await pending;
assert.equal(observed.length, 1, 'progress updates do not announce another attempt');
assert.equal(observed[0].attemptId, attempt.attemptId);
const failed = await createRuntimeAttempt({ buildId: 'failed', paths: { repo },
  observability: { correlation: { correlationId: 'failed-write' } } });
await assert.rejects(withRuntimeBindingObserver(value => observed.push(value), () => persistRuntimeAttempt(dir,
  failed, {}, { write: async () => { throw Object.assign(new Error('expected fixture disk failure'), { code: 'ENOSPC' }); } })),
{ code: 'ERR_RUNTIME_RECEIPT_PERSIST' });
assert.equal(observed.length, 1, 'a failed required write cannot bind monitoring');
await Promise.all(['left', 'right'].map(async id => {
  const own = [], current = await createRuntimeAttempt({ buildId: id, paths: { repo },
    observability: { correlation: { correlationId: id } } });
  await withRuntimeBindingObserver(value => own.push(value), async () => {
    await Promise.resolve();
    await persistRuntimeAttempt(dir, current, {}, { write: async () => { await Promise.resolve(); } });
  });
  assert.deepEqual(own.map(value => value.correlationId), [id], 'concurrent daemon jobs retain their own observer');
}));

// Explicit fixture command runs the real durable producer through the actual
// service executor and IPC runner. It performs no index/model/native work.
await fs.writeFile(path.join(toolRoot, 'package.json'), '{"type":"module"}');
await fs.writeFile(path.join(toolRoot, 'descendant.js'), `
import {initializeRuntimeReceipt} from ${JSON.stringify(new URL('../../../src/index/build/runtime/receipt.js', import.meta.url).href)};
await initializeRuntimeReceipt({buildRoot:${JSON.stringify(path.join(dir, 'descendant'))},buildId:'descendant',
  root:${JSON.stringify(repo)},stage:'stage2',observability:{correlation:{correlationId:'descendant'}},
  paths:{repo:${JSON.stringify(repo)}}});
process.send({kind:'descendant-complete'});
process.disconnect();
`);
await fs.writeFile(path.join(toolRoot, 'build_index.js'), `
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {initializeRuntimeReceipt} from ${JSON.stringify(new URL('../../../src/index/build/runtime/receipt.js', import.meta.url).href)};
import {parseObservabilityContextEnv} from ${JSON.stringify(new URL('../../../src/shared/observability.js', import.meta.url).href)};
const pick = name => process.argv[process.argv.indexOf(name) + 1];
const root = pick('--repo'), buildRoot = ${JSON.stringify(path.join(dir, 'subprocess'))};
process.send({kind:'unrelated-message'});
process.send({kind:'pairofcleats.runtime-binding',schemaVersion:1,pid:process.ppid,
  repoRoot:root,buildRoot,buildId:'foreign',attemptId:'foreign',correlationId:'foreign',stage:'stage2'});
await initializeRuntimeReceipt({buildRoot,buildId:'fixture-generation',root,stage:pick('--stage'),
  observability:parseObservabilityContextEnv(),paths:{repo:root,build:buildRoot}});
const messages = [];
await new Promise((resolve,reject) => {
  const child = fork(new URL('./descendant.js',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']});
  child.on('message',value => messages.push(value));
  child.on('error',reject);
  child.on('exit',code => code === 0 ? resolve() : reject(new Error('descendant failed: '+code)));
});
assert.deepEqual(messages,[{kind:'descendant-complete'}], 'inherited preload must not write to descendant IPC');
console.log('bounded receipt producer completed');
`);
for (const mode of ['daemon', 'subprocess']) {
  const buildRoot = path.join(dir, mode), logs = [], bindings = [];
  const job = bindClaimedJobExecution({ id: mode, repo, mode: 'code', stage: 'stage2',
    args: ['--repo', repo, '--stage', 'stage2'],
    onRuntimeBinding: 'serialized input is never a callback' });
  const stop = startBuildProgressMonitor({ job, repoPath: repo, stage: job.stage,
    repoCacheRoot: dir, expectRuntimeBinding: true, log: line => logs.push(line) });
  try {
    const executor = createJobExecutor({ isEmbeddingsQueue: false, serviceExecutionMode: mode,
      daemonWorkerConfig: {}, resolvedQueueName: 'index', embeddingExtraEnv: {},
      resolveRepoRuntimeEnv: () => ({}), toolRoot, completeNonRetriableFailure: async () => {
        throw new Error('valid fixture must execute');
      }, buildIndexImpl: async (root, options) => {
        await initializeRuntimeReceipt({ buildRoot, buildId: 'fixture-generation', root,
          stage: options.stage, observability: options.observability, paths: { repo: root, build: buildRoot } });
        return {};
      } });
    const result = await executor.executeClaimedJob({ job,
      jobLifecycle: { registerPromise: promise => promise }, logPath: path.join(dir, mode + '.log'),
      onRuntimeBinding: value => { bindings.push(value); assert.equal(stop.bindRuntime(value), true); } });
    assert.equal(result.runResult.exitCode, 0);
    assert.equal(bindings.length, 1, `${mode} must deliver the actual durable attempt once`);
    await stop.poll();
    assert.equal(stop.getDiagnostics().binding.attemptId, bindings[0].attemptId);
    assert.equal(stop.getDiagnostics().binding.buildRoot, buildRoot);
    assert.equal(stop.getDiagnostics().discoveries, 0);
    assert.equal(stop.getDiagnostics().executorBindings, 1);
    const state = JSON.parse(await fs.readFile(path.join(buildRoot, 'build_state.json')));
    assert.equal(state.runtime.latestAttemptId, bindings[0].attemptId);
    assert.equal(state.runtime.attempts[0].correlationId, job.observability.correlation.correlationId);
    if (mode === 'subprocess') assert.notEqual(bindings[0].pid, process.pid, 'binding arrives from the actual owned child');
    else assert.equal(bindings[0].pid, process.pid);
  } finally { await stop(); }
}
console.log('Service executor binds only durable attempts through isolated daemon scopes and the real bounded child IPC lifecycle.');
