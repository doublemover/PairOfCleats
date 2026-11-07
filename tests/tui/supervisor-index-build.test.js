import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
const { dir } = await prepareIsolatedTestCacheDir('supervisor-full-index-build');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, 'answer.js'), 'export function supervisedAnswer() { return 42; }\n');
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1,"quality":"fast"}');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', syncProcess: true,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const session = createSupervisorSession({ timeoutMs: 10000, reassembleEvents: true });
let sequence = 0;
const request = async (method, params) => {
  const jobId = `full-build-control-${++sequence}`; session.send({ op: 'workflow:run', jobId, method, params });
  const end = await session.waitForEvent(event => event.event === 'job:end' && event.jobId === jobId);
  assert.equal(end.status, 'done', JSON.stringify(end)); return end.result.data;
};
try {
  await session.waitForEvent(event => event.event === 'hello');
  const scope = await request('select', { kind: 'repo', target: repo });
  const preview = await request('preview', { scopeId: scope.id, commandId: 'index.build',
    values: { mode: 'code', threads: 1, 'stub-embeddings': true } });
  assert.equal(preview.launchable, true); assert.equal(preview.canonicalArgv.some(arg => arg.startsWith('--stage')), false);
  const launch = await request('launch', { scopeId: scope.id, previewId: preview.previewId, confirmed: true });
  assert.equal(launch.jobId, preview.plannedJobId);
  const end = await session.waitForEvent(event => event.event === 'job:end' && event.jobId === launch.jobId, 25000);
  await fs.writeFile(path.join(dir, 'full-build-end.json'), JSON.stringify(end, null, 2));
  assert.equal(end.status, 'done', JSON.stringify(end)); assert.equal(end.attempts, 1);
  assert.equal(end.workflow.publications[0].ready, true); assert.equal(end.workflow.publications[0].producedReadyGeneration, true);
  assert.equal(end.workflow.publications[0].currentValidation.ok, true);
  assert.ok(end.workflow.publications[0].producerCorrelations.includes(launch.jobId));
  const artifact = await session.waitForEvent(event => event.event === 'job:artifacts' && event.jobId === launch.jobId);
  assert.ok(artifact.artifacts.some(row => row.kind === 'index:code' && row.exists));
  assert.equal(await session.shutdown(), 0);
  for (const row of session.events.filter(event => event.event === 'job:spawn')) assert.equal(isProcessAlive(row.pid), false);
  assert.deepEqual(session.events.filter(event => event.event === 'log' && ['warn', 'error'].includes(event.level)), []);
} finally { session.forceKill(); }
console.log('A full default-stage build completes through the real typed supervisor, validates, promotes, captures artifacts and reaps children.');
