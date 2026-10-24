import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('supervisor-index-workflows');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const config = path.join(repo, '.pairofcleats.json');
await fs.writeFile(config, '{"threads":1,"quality":"fast"}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
let sequence = 0;
const request = async (method, params) => {
  const jobId = `workflow-control-${++sequence}`;
  session.send({ op: 'workflow:run', jobId, method, params });
  return session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId);
};
const success = async (...args) => {
  const event = await request(...args); assert.equal(event.status, 'done', JSON.stringify(event));
  return event.result.data;
};
try {
  const hello = await session.waitForEvent(event => event.event === 'hello');
  assert.equal(hello.capabilities.supportsIndexWorkflows, true);
  const scope = await success('select', { kind: 'repo', target: repo });
  const preview = await success('preview', { scopeId: scope.id, commandId: 'index.build', values: { mode: 'code', threads: 1, sqlite: false, 'stub-embeddings': true } });
  assert.equal(preview.launchable, true);
  await fs.writeFile(config, '{"threads":2,"quality":"fast"}');
  const launch = await success('launch', { scopeId: scope.id, previewId: preview.previewId, confirmed: true });
  const failed = await session.waitForEvent(event => event.event === 'job:end' && event.jobId === launch.jobId);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'ERR_TUI_WORKFLOW_STALE');
  assert.equal(session.events.some(event => event.jobId === launch.jobId && event.event === 'job:spawn'), false,
    'the admitted stale plan must fail before spawning a build');
  assert.equal(failed.workflow.publications[0].producedReadyGeneration, false);
  const repeated = await request('launch', { scopeId: scope.id, previewId: preview.previewId, confirmed: true });
  assert.equal(repeated.status, 'failed'); assert.equal(repeated.error.code, 'ERR_TUI_WORKFLOW_STALE');
  const invalid = await request('describe', { command: 'never execute' });
  assert.equal(invalid.status, 'failed'); assert.equal(invalid.error.code, 'ERR_TUI_WORKFLOW_REQUEST');
  const status = await success('status', { scopeId: scope.id });
  assert.equal(status.publications[0].published, false); assert.equal(status.publications[0].ready, false);
  assert.equal(session.events.filter(event => event.event === 'log' && ['warn', 'error'].includes(event.level)).length, 0);
  assert.equal(await session.shutdown(), 0);
} finally { session.forceKill(); }
console.log('Actual supervisor rejects stale plans before child creation and preserves invalid-request negatives.');
