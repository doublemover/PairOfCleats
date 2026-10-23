import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { MANAGED_CHILD_CACHE_FAMILIES, planManagedChildStorage, prepareManagedChildStorage, resolveManagedChildCacheFamily } from '../../../src/shared/storage/child-environment.js';
import { applyToolchainDaemonPolicyEnv, resolveNoProvisionToolingEnvironment } from '../../../src/shared/toolchain-env.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { buildToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { runNode } from '../../helpers/run-node.js';

const temporary = await makeTempDir('poc-python-graphviz-child-');
try {
  const home = path.join(temporary, 'application-home');
  const cwd = path.join(temporary, 'project');
  await fs.mkdir(cwd);
  const layout = resolveStorageLayout({ home, env: {} });
  const baseEnv = { HOME: path.join(temporary, 'user-home'), HF_HOME: path.join(temporary, 'external-hf'),
    FONTCONFIG_FILE: 'explicit-font-config', FONTCONFIG_PATH: 'explicit-font-path', PYTHONUSERBASE: 'explicit-python-user' };
  const before = { ...baseEnv };
  const input = { layout, managed: true, toolIdentity: 'selected-tool@1', projectIdentity: cwd, cwd, baseEnv };
  for (const command of ['python', 'python3', 'python3.13.exe', 'pythonw.exe', 'pip', 'pip3.14', 'py.exe']) {
    assert.equal(resolveManagedChildCacheFamily({ command }), 'python');
  }
  for (const command of ['dot.exe', 'neato', 'fdp', 'sfdp', 'circo', 'twopi', 'osage', 'patchwork']) {
    assert.equal(resolveManagedChildCacheFamily({ command }), 'graphviz');
  }
  for (const command of ['fc-cache', 'fc-list.exe', 'fc-match', 'fc-scan']) {
    assert.equal(resolveManagedChildCacheFamily({ command }), 'fontconfig');
  }
  assert.equal(resolveManagedChildCacheFamily({ command: 'not-python-helper' }), null);
  assert.equal(resolveManagedChildCacheFamily({ command: 'toString' }), null);
  assert.throws(() => resolveManagedChildCacheFamily({ family: {} }), /must be a string/);
  assert.throws(() => { MANAGED_CHILD_CACHE_FAMILIES.python[0][0] = 'HOME'; }, TypeError,
    'the shared family registry cannot be rewritten after an approval is planned');
  assert.equal(resolveManagedChildCacheFamily({ command: 'npm', family: 'pip' }), 'python', 'selected recipe family outranks launcher basename');
  assert.equal(await fs.stat(home).catch(error => error.code), 'ENOENT', 'planning does not create an application home');

  for (const [family, command] of [['python', 'pip3.13'], ['graphviz', 'dot'], ['fontconfig', 'fc-cache']]) {
    const managedStorage = { ...input, command, toolId: `fixture-${family}`, runId: `fixture-${family}-run` };
    const plan = planManagedChildStorage(managedStorage);
    const routed = resolveNoProvisionToolingEnvironment(baseEnv, { managedStorage });
    assert.equal(plan.family, family);
    assert.equal(routed.ERL_CRASH_DUMP, undefined, 'another family never receives an undeclared BEAM write location');
    for (const location of plan.locations) {
      assert.equal(routed[location.environmentKey], plan.env[location.environmentKey], 'actual toolchain environment uses the canonical declared route');
      assert.equal(location.cleanupAuthority, false);
    }
    assert.equal(routed.HOME, baseEnv.HOME);
    assert.equal(routed.HF_HOME, baseEnv.HF_HOME);
    assert.equal(routed.PYTHONUSERBASE, baseEnv.PYTHONUSERBASE);
    assert.equal(routed.FONTCONFIG_FILE, baseEnv.FONTCONFIG_FILE);
    assert.equal(routed.FONTCONFIG_PATH, baseEnv.FONTCONFIG_PATH);
    const prepared = await prepareManagedChildStorage(plan, { authorizedRoots: [home] });
    const probe = runNode([path.join(process.cwd(), 'tests/fixtures/storage/python-graphviz-cache-probe.js'), family],
      `${family} authored child writes`, cwd, routed, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);
    const actual = JSON.parse(probe.stdout);
    for (const file of actual.paths) assert.equal(plan.locations.some(location => isPathWithinRoot(file, location.path)), true);
    assert.equal(actual.env.HOME, baseEnv.HOME);
    assert.equal(actual.env.HF_HOME, baseEnv.HF_HOME);
    const executable = path.join(layout.descriptors.tooling.path, `fixture-${family}-consumer`);
    await fs.writeFile(executable, 'authored consumer identity; not vendor qualification');
    const receipt = buildToolInstallReceipt({ tool: { id: `fixture-${family}` }, toolingRoot: layout.descriptors.tooling.path,
      result: { path: executable, probe: { ok: true, identity: { version: '1' } } }, action: { cmd: command, args: [], scope: 'cache',
        storage: { ...prepared, settlement: { resourceId: `${plan.profileIdentity}:${plan.runId}`, settled: true, pending: false } } } });
    writeToolInstallReceipt(layout.descriptors.tooling.path, receipt);
    const inventory = await inspectStorageCategory({ category: 'managed-installations', root: layout.descriptors.tooling.path, home,
      registeredRoots: Object.values(layout.descriptors).map(descriptor => descriptor.path) });
    assert.equal(inventory.complete, true);
    assert.equal(inventory.observedWrites, false, 'fake child writes do not qualify real vendor write containment');
    const recorded = inventory.receipts.find(entry => entry.toolId === `fixture-${family}`);
    assert.equal(recorded.locations.some(location => location.logicalBytes > 0), true);
    assert.equal(recorded.locations.every(location => location.cleanupAuthority === false), true);
    assert.deepEqual(baseEnv, before, 'only the spawned child environment is changed');
  }

  const relative = planManagedChildStorage({ ...input, command: 'python', toolId: 'python-explicit', runId: 'explicit',
    baseEnv: { ...baseEnv, PIP_CACHE_DIR: ' deliberate pip cache ', PYTHONPYCACHEPREFIX: 'project-pycache' } });
  assert.equal(relative.env.PIP_CACHE_DIR, ' deliberate pip cache ');
  assert.equal(relative.locations.find(location => location.environmentKey === 'PIP_CACHE_DIR').path,
    path.resolve(cwd, ' deliberate pip cache '), 'significant explicit path whitespace is not rewritten in the ownership receipt');
  assert.equal(relative.locations.find(location => location.environmentKey === 'PIP_CACHE_DIR').external, true);
  const xdg = planManagedChildStorage({ ...input, command: 'dot', toolId: 'graphviz-explicit', runId: 'external',
    baseEnv: { XDG_CACHE_HOME: 'external-xdg' } });
  assert.equal(xdg.env.XDG_CACHE_HOME, 'external-xdg');
  assert.equal(xdg.exceptions.find(exception => exception.environmentKey === 'XDG_CACHE_HOME').status, 'external-shared-read-only-inventory');
  const external = applyToolchainDaemonPolicyEnv(baseEnv, { managedStorage: { ...input, command: 'erl', managed: false } });
  assert.equal(external.ERL_CRASH_DUMP, undefined);
  assert.equal(external.XDG_CACHE_HOME, undefined);
  assert.equal(external.PIP_CACHE_DIR, undefined);
  const unsupported = planManagedChildStorage({ ...input, command: 'unknown-vendor-tool', toolId: 'unknown', runId: 'unknown' });
  assert.equal(unsupported.exceptions.some(exception => exception.status === 'unsupported-owner-adapter-required'), true);
  const unregisteredFamily = planManagedChildStorage({ ...input, family: 'toString', command: 'dot', toolId: 'unregistered-family', runId: 'unregistered' });
  assert.equal(unregisteredFamily.exceptions.some(exception => exception.status === 'unsupported-owner-adapter-required'), true,
    'unknown explicit families keep their unsupported exception instead of inheriting Object.prototype routes');

  if (process.platform === 'win32') {
    assert.throws(() => planManagedChildStorage({ ...input, command: 'pip', toolId: 'case-conflict', runId: 'conflict',
      baseEnv: { PIP_CACHE_DIR: 'first-cache', pip_cache_dir: 'second-cache' } }), /conflicting environment aliases/);
    const aliases = { XDG_CACHE_HOME: 'same-cache', xdg_cache_home: 'same-cache' };
    const same = planManagedChildStorage({ ...input, command: 'dot', toolId: 'same-alias', runId: 'same', baseEnv: aliases });
    assert.equal(Object.keys(same.env).filter(key => key.toLowerCase() === 'xdg_cache_home').length, 1);
    assert.equal(same.env.XDG_CACHE_HOME, 'same-cache');
    assert.equal(Object.keys(aliases).length, 2, 'alias normalization never mutates the host environment');
  }
} finally { await rmDirRecursive(temporary); }
console.log('Python and Graphviz authored child routing passed');
