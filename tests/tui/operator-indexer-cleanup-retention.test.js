import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiIndexer } from '../../tools/tui/operator/indexer.js';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { ensureQueueDir, enqueueJob, loadQueue, loadQuarantine } from '../../tools/service/queue.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('native-indexer-cleanup-retention');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
initGitRepo(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const queueDir = path.join(dir, 'queue'); await ensureQueueDir(queueDir);
const workspace = path.join(dir, 'workspace.jsonc');
await fs.writeFile(workspace, JSON.stringify({ schemaVersion: 1, repos: [{ root: repo }] }));
await fs.writeFile(path.join(dir, 'service.json'), JSON.stringify({ repos: [{ id: 'owned', path: repo }], queueDir,
  queue: { maxRetries: 3 }, security: { allowShell: false, allowPathEscape: false } }));
await enqueueJob(queueDir, { id: 'owned-job', repo, mode: 'all' }, null, 'index');
const scopes = createTuiSettingsSession({ toolRoot: process.cwd(), env });
const scope = await scopes.selectScope({ kind: 'workspace', target: workspace });
let closed = false, executions = 0;
const original = Object.assign(new Error('original registered resource disposer'), {
  code: 'ORIGINAL_NATIVE_CLOSE', cacheOwnershipPending: true, cacheOwnershipReleased: () => closed });
const actor = createTuiIndexer({ toolRoot: process.cwd(), env, requireScope: id => scopes.captureScope(id),
  createExecutor: () => ({ buildDefaultRunResult: () => ({ exitCode: 1 }),
    executeClaimedJob: async ({ jobLifecycle }) => {
      executions++;
      jobLifecycle.registerCleanup(async () => { throw original; });
      return { handled: false, runResult: { exitCode: 0 } };
    } }) });
try {
  const prepared = await actor.prepare({ scope, values: { config: 'service.json', command: 'work' } });
  let retained;
  await assert.rejects(prepared.execute({ signal: new AbortController().signal, env, onActivity: () => {} }), error => {
    retained = error; return error.code === 'QUEUE_CLEANUP_PENDING' && error.cause === original;
  });
  assert.equal(actor.status(scope.id).length, 1, 'execution rejection cannot discard a retained native session owner');
  assert.equal(actor.status(scope.id)[0].phase, 'cleanup-pending');
  assert.equal((await loadQueue(queueDir, 'index')).cleanupHolds.length, 1);
  await assert.rejects(actor.dispose(), { code: 'QUEUE_CLEANUP_PENDING' });
  assert.equal(actor.status(scope.id).length, 1);
  await assert.rejects(prepared.execute({ signal: new AbortController().signal, env, onActivity: () => {} }),
    { code: 'ERR_TUI_INDEXER_ADMISSION' });
  original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
  await assert.rejects(actor.dispose(), { code: 'QUEUE_CLEANUP_PENDING' });
  closed = true;
  await actor.dispose();
  assert.deepEqual(actor.status(scope.id), []);
  assert.equal(retained.cacheOwnershipReleased(), true);
  assert.equal((await loadQueue(queueDir, 'index')).cleanupHolds.length, 0);
  assert.equal((await loadQuarantine(queueDir, 'index')).jobs[0].status, 'failed');
  assert.equal(executions, 1, 'native disposal reconciles the original owner without executing a replacement job');
} finally { closed = true; await actor.dispose(); scopes.dispose(); }
console.log('native indexer sessions retain original failed cleanup and reconcile through the durable queue owner');
