import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage, prepareManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

const temporary = await makeTempDir('poc-managed-child-routing-');
try {
  const layout = resolveStorageLayout({ home: temporary, env: {} });
  const input = { layout, managed: true, command: 'npm', toolId: 'fixture-npm-tool', toolIdentity: 'fixture@1', runId: 'fixture-run', baseEnv: {} };
  const plan = planManagedChildStorage(input);
  for (const runId of ['.', '..']) assert.throws(() => planManagedChildStorage({ ...input, runId }), /exact tool\/profile and run identities/,
    'dot segments cannot collapse run scratch into a shared profile or parent');
  assert.ok(plan.env.npm_config_cache.startsWith(layout.descriptors.tooling.path));
  assert.equal(plan.env.HOME, undefined);
  assert.equal(plan.env.GEM_HOME, undefined);
  assert.deepEqual(await fs.readdir(temporary), [], 'routing plans do not create directories');
  await prepareManagedChildStorage(plan, { authorizedRoots: [temporary] });
  const probe = runNode(['tests/fixtures/storage/child-write-probe.js'], 'managed child write routing', process.cwd(), plan.env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const written = JSON.parse(probe.stdout);
  for (const file of written.paths) assert.ok(plan.locations.some(location => file.startsWith(location.path)), 'observed fake-tool writes remain declared');
  const override = path.join(temporary, 'user-cache');
  const external = planManagedChildStorage({ ...input, baseEnv: { npm_config_cache: override, HOME: '/unchanged-user-home' } });
  assert.equal(external.env.npm_config_cache, override);
  assert.equal(external.env.HOME, '/unchanged-user-home');
  assert.equal(external.exceptions.some(exception => exception.path === override), true);
  const global = planManagedChildStorage({ ...input, managed: false, baseEnv: { npm_config_cache: override } });
  assert.deepEqual(global.env, { npm_config_cache: override });
  assert.equal(global.locations.length, 0);
  const otherVersion = planManagedChildStorage({ ...input, toolIdentity: 'fixture@2' });
  assert.notEqual(otherVersion.profileIdentity, plan.profileIdentity);
  const go = planManagedChildStorage({ ...input, family: 'go', baseEnv: { GOROOT: 'explicit-sdk', GOTOOLCHAIN: 'go1.26.1', GOCACHE: override } });
  assert.equal(go.env.GOROOT, 'explicit-sdk');
  assert.equal(go.env.GOTOOLCHAIN, 'go1.26.1');
  assert.equal(go.env.GOCACHE, override);
} finally { await rmDirRecursive(temporary); }
console.log('managed child routing passed');
