import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { setImmediate as turn } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { createTuiCacheMaintenance } from '../../tools/tui/operator/cache-maintenance.js';
import { describeIndexWorkflows, buildIndexWorkflowArgv } from '../../tools/tui/operator/index-catalog.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { loadUserConfig, getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

// Ordinary metadata fixtures and injected child-owner settlement exercise the
// native bridge. They do not qualify SQLite, LMDB, IPC or real process teardown.
const { dir } = await prepareIsolatedTestCacheDir('native-cache-maintenance');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: true,
  extraEnv: { NODE_OPTIONS: null, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const config = loadUserConfig(repo, { env }), root = getRepoCacheRoot(repo, config);
const indexRoot = path.join(root, 'builds', 'native-generation');
const database = path.join(indexRoot, 'index-sqlite', 'index-code.db');
await fs.mkdir(path.dirname(database), { recursive: true }); await fs.writeFile(database, 'metadata fixture');
const pointerPath = path.join(root, 'builds', 'current.json');
const pointer = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  buildId: 'native-generation', buildRoot: path.relative(root, indexRoot), modes: ['code', 'prose'] };
await fs.writeFile(pointerPath, JSON.stringify(pointer));
const scope = { id: 'selected', kind: 'repo', configRoot: repo, target: repo };
const command = describeIndexWorkflows({ backendDelegationEnabled: true }).find(row => row.id === 'sqlite.compact');
const values = { mode: 'code' }, argv = buildIndexWorkflowArgv(command, values, scope);
const preview = { scope, command, values, argv };
const fixture = ({ ownerFailure = null, selectedEnv = env, commandId = 'sqlite.compact' } = {}) => {
  let resolveOwner, rejectOwner, started, closed = false, settled = false, cancellation = 0, resumed = 0;
  const completion = new Promise((resolve, reject) => { resolveOwner = resolve; rejectOwner = reject; });
  completion.catch(() => {});
  const child = { pid: 123, stdout: new PassThrough(), stderr: new PassThrough() };
  const ownerStarted = new Promise(resolve => { started = resolve; });
  const actor = createTuiCacheMaintenance({ toolRoot: process.cwd(), requireScope: () => scope,
    env: selectedEnv, delegationEnabled: true,
    drainLocalReaders: async input => ({ drained: true, pending: false, leaseId: input.leaseId }),
    prepareHandoff: async (cacheRoot, options) => {
      assert.equal(cacheRoot, root);
      const receipt = await options.drain({ root: cacheRoot, leaseId: 'exact-local-lease' });
      assert.equal(receipt.leaseId, 'exact-local-lease');
      return { leaseId: 'exact-local-lease' };
    }, cancelHandoff: () => { resumed += 1; },
    startOwner: async (cacheRoot, options) => {
      assert.equal(cacheRoot, root); assert.equal(options.coordinationRoot, null);
      assert.ok(options.args.includes(`--index-root=${indexRoot}`));
      assert.ok(options.args.includes('--progress=jsonl'));
      const entry = await fs.realpath(path.join(process.cwd(), commandId === 'sqlite.compact'
        ? 'tools/build/compact-sqlite-index.js' : 'tools/build/lmdb-index.js'));
      assert.equal(options.entry, entry);
      const sha256 = createHash('sha256').update(await fs.readFile(entry)).digest('hex');
      const expected = createHash('sha256').update(stableStringify({ commandId, entry, sha256, args: options.args })).digest('hex');
      assert.equal(options.commandIdentity, expected, 'parent digest matches the canonical realpath entry/bytes/args guard');
      if (ownerFailure) throw ownerFailure;
      started(options);
      return { child, completion, inspect: () => ({ closed, settled, pending: !closed || !settled }) };
    }, stopChild: async selected => { assert.equal(selected, child); cancellation += 1; } });
  return { actor, child, ownerStarted, finish: () => { closed = true; settled = true;
    resolveOwner({ protected: false, result: { settled: true, exitCode: 0, signal: null } }); },
  pending: ({ canonical = true } = {}) => { closed = true; rejectOwner(Object.assign(new Error('No owner closure receipt.'),
    canonical ? { code: 'ERR_REPO_CACHE_DELEGATION_PENDING', cacheOwnershipPending: true } : {})); },
  get cancellation() { return cancellation; }, get resumed() { return resumed; } };
};
const context = signal => ({ signal, env, jobId: 'owned-backend', launcherJob: { id: 'launch-operation', internal: true },
  onSpawn: () => {}, onStdout: () => {}, onStderr: () => {}, onActivity: () => {} });
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  assert.equal(plan.review.targets[0].path, database);
  const running = plan.execute(context(new AbortController().signal));
  await f.ownerStarted; await turn();
  assert.throws(f.actor.assertAdmission, { code: 'ERR_TUI_BACKEND_MAINTENANCE_ACTIVE' });
  f.child.stdout.write('canonical result'); f.finish();
  const result = await running;
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, 'canonical result');
  assert.equal(f.actor.status().blocked, false); assert.equal(f.resumed, 0);
}
{
  const command = describeIndexWorkflows({ backendDelegationEnabled: true }).find(row => row.id === 'lmdb.build');
  const values = { mode: 'all' }, f = fixture({ commandId: 'lmdb.build' });
  const plan = await f.actor.prepare({ scope, command, values, argv: buildIndexWorkflowArgv(command, values, scope) });
  assert.deepEqual(plan.review.targets.map(row => row.path), ['code', 'prose']
    .map(mode => path.join(indexRoot, 'index-lmdb', `index-${mode}`)));
  const running = plan.execute(context(new AbortController().signal));
  await f.ownerStarted; await turn(); f.finish();
  assert.equal((await running).exitCode, 0);
  assert.equal(f.actor.status().blocked, false);
}
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  const running = plan.execute(context(new AbortController().signal));
  const rejected = assert.rejects(running, { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
  await f.ownerStarted; f.pending({ canonical: false }); await rejected;
  assert.equal(f.actor.status().blocked, true, 'closed child plus an unclassified completion rejection cannot prove owner settlement');
  assert.equal(f.resumed, 0);
}
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  let finished = false;
  const running = plan.execute({ ...context(new AbortController().signal), onActivity: () => {
    throw new Error('Consumer activity callback failed.');
  } }).finally(() => { finished = true; });
  const rejected = assert.rejects(running, /Consumer activity callback failed/);
  await f.ownerStarted; await turn();
  assert.equal(f.cancellation, 1); assert.equal(finished, false);
  f.finish(); await rejected;
  assert.equal(f.actor.status().blocked, false, 'only successful canonical completion restores admission after callback failure');
  assert.equal(f.resumed, 0);
}
{
  const f = fixture({ ownerFailure: Object.assign(new Error('Foreign reader lease remains active.'),
    { code: 'ERR_REPO_CACHE_DELEGATION_BUSY' }) }), plan = await f.actor.prepare(preview);
  await assert.rejects(plan.execute(context(new AbortController().signal)), { code: 'ERR_REPO_CACHE_DELEGATION_BUSY' });
  assert.equal(f.resumed, 1, 'a failed pre-child handoff is cancelled through its canonical owner');
  assert.equal(f.actor.status().blocked, false);
}
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  await fs.writeFile(pointerPath, JSON.stringify({ ...pointer, observedMetadata: 'changed same generation' }));
  await assert.rejects(plan.execute(context(new AbortController().signal)), { code: 'ERR_TUI_BACKEND_STALE' });
  await fs.writeFile(pointerPath, JSON.stringify(pointer));
}
{
  const f = fixture();
  await fs.writeFile(pointerPath, JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildRoot: root, modes: ['code'] }));
  await assert.rejects(f.actor.prepare(preview), { code: 'ERR_TUI_BACKEND_GENERATION' });
  await fs.writeFile(pointerPath, JSON.stringify(pointer));
}
{
  const f = fixture({ selectedEnv: { ...env, NODE_OPTIONS: '--import=external-hook.js' } });
  await assert.rejects(f.actor.prepare(preview), { code: 'ERR_TUI_BACKEND_NODE_OPTIONS' });
}
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  const running = plan.execute(context(new AbortController().signal));
  const rejected = assert.rejects(running, { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
  await f.ownerStarted; f.pending(); await rejected;
  assert.equal(f.actor.status().pending, true); assert.equal(f.actor.status().blocked, true);
  assert.throws(f.actor.assertAdmission, { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
  assert.equal(f.resumed, 0, 'unknown child settlement cannot cancel/restore the handoff');
}
{
  const f = fixture(), plan = await f.actor.prepare(preview), abort = new AbortController();
  let finished = false;
  const running = plan.execute(context(abort.signal)).finally(() => { finished = true; });
  const rejected = assert.rejects(running, { code: 'ERR_TUI_BACKEND_OWNERSHIP_PENDING' });
  await f.ownerStarted; abort.abort(); await turn();
  assert.equal(f.cancellation, 1); assert.equal(finished, false, 'kill request does not release lifetime capacity');
  f.pending(); await rejected;
  assert.equal(f.actor.status().blocked, true);
}
{
  const f = fixture(), plan = await f.actor.prepare(preview);
  await fs.writeFile(database, 'changed metadata fixture');
  await assert.rejects(plan.execute(context(new AbortController().signal)), { code: 'ERR_TUI_BACKEND_STALE' });
  assert.equal(f.actor.status(), null);
}
const unavailable = createTuiCacheMaintenance({ toolRoot: process.cwd(), requireScope: () => scope, env });
await assert.rejects(unavailable.prepare(preview), { code: 'ERR_TUI_BACKEND_DELEGATION_UNAVAILABLE' });
console.log('Native delegated maintenance retains exact reviewed scope and fences unknown/cancelled settlement');
