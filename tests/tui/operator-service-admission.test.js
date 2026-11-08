// Actual typed workflow adapter with inert job admission; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiIndexWorkflows } from '../../tools/tui/operator/index-workflows.js';
import { createTuiSettingsSession } from '../../tools/tui/operator/settings.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('operator-service-admission');
const repo = path.join(dir, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1}');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: true });
const scopes = createTuiSettingsSession({ toolRoot: process.cwd(), env });
const jobs = new Map(), started = [];
let openGate, rejectedAdmission = false;
const gate = new Promise(resolve => { openGate = resolve; });
const actor = createTuiIndexWorkflows({ scopes, env, getJob: id => jobs.get(id), cancelJob: () => true,
  startJob: async request => {
    started.push(request.jobId);
    if (rejectedAdmission) throw Object.assign(new Error('inert admission failed'), { code: 'ERR_FIXTURE_ADMISSION' });
    await gate;
    jobs.set(request.jobId, { id: request.jobId, status: 'running', internal: false, finalized: false,
      settled: false, abortController: new AbortController(), settlement: Promise.resolve() });
  } });
const pending = [];
try {
  const scope = await scopes.selectScope({ kind: 'repo', target: repo });
  const preview = async () => {
    const result = await actor.preview({ scopeId: scope.id, commandId: 'service.api', values: { port: '40000' } });
    assert.equal(result.launchable, true);
    return { scopeId: scope.id, previewId: result.previewId, confirmed: true };
  };
  const requests = [];
  for (let index = 0; index < 7; index++) requests.push(await preview());
  for (const request of requests.slice(0, 6)) pending.push(actor.launch(request));
  assert.equal(started.length, 6);
  await assert.rejects(actor.launch(requests[6]), { code: 'ERR_TUI_SERVICE_CONTROL_LIMIT' });
  assert.equal(started.length, 6, 'control exhaustion must reject before canonical supervisor admission');
  openGate();
  const launched = await Promise.all(pending);
  assert.equal(launched.every(result => typeof result.serviceControlId === 'string'), true);
  assert.equal(actor.services({ scopeId: scope.id }).ownedServices.length, 6);

  for (const owner of jobs.values()) owner.settled = true;
  jobs.clear(); // Exact inert protocol owners have no resources; prune may release these slots.
  rejectedAdmission = true;
  for (let index = 0; index < 7; index++) {
    await assert.rejects(actor.launch(await preview()), { code: 'ERR_FIXTURE_ADMISSION' });
  }
  rejectedAdmission = false;
  assert.equal((await actor.launch(await preview())).launched, true,
    'failed admission returns its own reservation without leaking or raising capacity');
} finally {
  openGate();
  await Promise.allSettled(pending);
  await actor.dispose();
  await scopes.dispose();
}
console.log('Service control capacity precedes actual typed workflow admission and survives admission failures.');
