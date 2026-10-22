import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiIndexer } from '../../tools/tui/operator/indexer.js';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { ensureQueueDir, enqueueJob, loadQueue } from '../../tools/service/queue.js';
import { getServiceShutdownPaths, saveServiceShutdownState } from '../../tools/service/shutdown-state.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('native-indexer-ownership');
const repos = [path.join(dir, 'a'), path.join(dir, 'b'), path.join(dir, 'foreign')];
for (const repo of repos) await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const queueDir = path.join(dir, 'queue'); await ensureQueueDir(queueDir);
const workspace = path.join(dir, 'workspace.jsonc'), configFile = path.join(dir, 'service.json');
await fs.writeFile(workspace, JSON.stringify({ schemaVersion: 1, repos: repos.slice(0, 2).map(root => ({ root })) }));
const config = { repos: repos.slice(0, 2).map((repo, index) => ({ id: `repo-${index}`, path: repo })), queueDir,
  queue: { maxRetries: 0 }, security: { allowShell: false, allowPathEscape: false } };
await fs.writeFile(configFile, JSON.stringify(config));
for (const [id, repo, args] of [['foreign', repos[2]], ['custom', repos[0], ['--repo', repos[2]]], ['owned', repos[1]]]) {
  await enqueueJob(queueDir, { id, repo, mode: 'all', reason: id, args, createdAt: new Date().toISOString() }, null, 'index');
}
await saveServiceShutdownState(queueDir, { mode: 'running' }, 'index');
const shutdownFile = getServiceShutdownPaths(queueDir, 'index').statePath;
const beforeShutdown = await fs.readFile(shutdownFile, 'utf8');
const foreignBefore = (await loadQueue(queueDir, 'index')).jobs.filter(job => job.id !== 'owned');
const scopes = createTuiSettingsSession({ toolRoot: process.cwd(), env });
const scope = await scopes.selectScope({ kind: 'workspace', target: workspace });
let claimed;
const started = new Promise(resolve => { claimed = resolve; });
const actor = createTuiIndexer({ toolRoot: process.cwd(), env, requireScope: id => scopes.captureScope(id),
  createExecutor: () => ({ buildDefaultRunResult: () => ({ exitCode: 1 }),
    executeClaimedJob: async ({ job, abortSignal }) => {
      assert.equal(job.id, 'owned'); assert.ok(job.lease.owner.startsWith('queue-worker:'));
      claimed();
      if (!abortSignal.aborted) await new Promise(resolve => abortSignal.addEventListener('abort', resolve, { once: true }));
      return { handled: false, runResult: { exitCode: 130, cancelled: true, shutdownMode: 'cancel' } };
    } }) });
const prepared = await actor.prepare({ scope, values: { config: 'service.json', command: 'work', watch: true } });
assert.equal(prepared.review.repositories.length, 2);
const abort = new AbortController();
const running = prepared.execute({ signal: abort.signal, env, onActivity: () => {} });
await started; abort.abort();
const result = await running;
assert.equal(result.exitCode, 130);
const jobs = (await loadQueue(queueDir, 'index')).jobs;
assert.deepEqual(jobs.filter(job => job.id !== 'owned'), foreignBefore, 'foreign/custom argv jobs are untouched');
assert.equal(jobs.find(job => job.id === 'owned').status, 'queued', 'canonical cancellation completion releases and requeues its own lease');
assert.equal(await fs.readFile(shutdownFile, 'utf8'), beforeShutdown, 'local cancellation publishes no global shutdown telemetry');
const stale = await actor.prepare({ scope, values: { config: 'service.json', command: 'status' } });
await fs.writeFile(configFile, JSON.stringify({ ...config, queue: { maxRetries: 1 } }));
await assert.rejects(stale.execute({ signal: new AbortController().signal }), { code: 'ERR_TUI_INDEXER_STALE' });
await actor.dispose(); scopes.dispose();
console.log('Native multi-repo indexer claims/settles only reviewed jobs and preserves global shutdown');
