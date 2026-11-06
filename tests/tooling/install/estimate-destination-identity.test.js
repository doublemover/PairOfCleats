import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInstallEstimateDestinations, bindDeclaredInstallAdmission, resolveDeclaredInstallAdmission,
  runToolInstallChild } from '../../../tools/tooling/install-execution.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const cases = JSON.parse(await fs.readFile(new URL('./estimate-destination-identity.test.js.cases.json', import.meta.url))).cases;
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/estimate-destination-identity/')[1];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('install-destination-' + selected);
const home = path.join(dir, 'home'), artifacts = path.join(home, 'tooling'), scratch = path.join(home, 'scratch');
const alias = process.platform === 'win32' ? artifacts.toUpperCase() : artifacts + path.sep + '.';
const bytes = 96 * 1024, hard = 128 * 1024;
const original = { destination: 'artifacts', requiredBytes: bytes, minimumFreeBytes: 0, hardBytes: hard };
const duplicate = { hardBytes: hard, minimumFreeBytes: 0, requiredBytes: bytes, root: alias };
const projection = { artifactRoot: artifacts, storagePlan: { locations: [], scratch } };
try {
  if (selected === 'aliases') {
    const result = resolveInstallEstimateDestinations([original, duplicate, { destination: 'scratch', requiredBytes: bytes }], projection);
    assert.equal(result.writes.length, 2, 'equivalent native destination aliases reserve one allocation');
    assert.equal(result.writes[0].root, artifacts); assert.equal(result.writes[0].requiredBytes, bytes);
    assert.equal(result.writes[0].hardBytes, hard);
    const forecast = resolveDeclaredInstallAdmission({ storageEstimate: { complete: true, basis: 'canonical-build-forecast-v1', writes: [original] } });
    assert.equal(forecast.state, 'deferred-unqualified-build-allocation');
    assert.equal(bindDeclaredInstallAdmission(forecast, projection), null, 'shape/route projection cannot qualify a forecast');
  } else if (selected === 'field-order') {
    const result = resolveInstallEstimateDestinations([original, { ...duplicate, root: artifacts }], projection);
    assert.equal(result.writes.length, 1, 'equal budgets do not conflict because the caller wrote properties in another order');
    const defaults = resolveInstallEstimateDestinations([{ destination: 'artifacts', requiredBytes: bytes },
      { root: artifacts, requiredBytes: bytes, minimumFreeBytes: 0, hardBytes: null }], projection);
    assert.deepEqual(defaults.writes, [{ root: artifacts, requiredBytes: bytes, minimumFreeBytes: 0, hardBytes: null }]);
  } else if (selected.endsWith('-conflict')) {
    const field = { 'required-conflict': 'requiredBytes', 'free-conflict': 'minimumFreeBytes', 'hard-conflict': 'hardBytes' }[selected];
    assert.throws(() => resolveInstallEstimateDestinations([original, { ...duplicate, [field]: duplicate[field] + 1 }], projection), /Conflicting allocation estimates/);
  } else if (selected === 'invalid-budget') {
    for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined]) {
      assert.throws(() => resolveInstallEstimateDestinations([{ destination: 'artifacts', requiredBytes: value }], projection), TypeError);
    }
    assert.throws(() => resolveInstallEstimateDestinations([{ root: 'relative', requiredBytes: 1 }], projection), TypeError);
    assert.throws(() => resolveInstallEstimateDestinations([null], projection), TypeError);
  } else if (selected === 'uncovered') {
    const plan = { ...projection, storagePlan: { locations: [{ environmentKey: 'TOOL_CACHE', path: path.join(dir, 'other-cache') }], scratch } };
    assert.equal(resolveInstallEstimateDestinations([original], plan), null, 'deduplication cannot drop another real write root');
    assert.throws(() => resolveInstallEstimateDestinations([{ environmentKey: 'UNKNOWN_CACHE', requiredBytes: 1 }], plan), /does not match an actual child write destination/);
  } else {
    const layout = resolveStorageLayout({ home, overrides: { tooling: artifacts }, env: {} });
    const plan = planManagedChildStorage({ layout, family: 'native', command: process.execPath, cwd: dir,
      managed: true, toolId: 'explicit-inert-fixture', toolIdentity: 'destination-alias-regression',
      baseEnv: { SystemRoot: process.env.SystemRoot || '', PATH: process.env.PATH || '' } });
    const admission = resolveInstallEstimateDestinations([original, duplicate, { destination: 'scratch', requiredBytes: bytes, hardBytes: hard }],
      { artifactRoot: artifacts, storagePlan: plan });
    assert.equal(admission.writes.length, 2);
    await fs.mkdir(artifacts, { recursive: true });
    const output = path.join(artifacts, 'owned-result');
    const result = await runToolInstallChild({ command: process.execPath,
      args: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'owned')", output],
      options: { cwd: dir, timeoutMs: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
      storagePlan: plan, layout, artifactRoot: artifacts, admission });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.status, 0);
    assert.equal(result.settlement.settled, true); assert.equal(await fs.readFile(output, 'utf8'), 'owned');
    const coordinationRoot = path.join(layout.descriptors.state.path, 'storage-access');
    assert.equal((await inspectStorageAccess(artifacts, { coordinationRoot })).protected, false, 'exact child close releases the original reservation/session');
    assert.equal((await inspectStorageAccess(plan.scratch, { coordinationRoot })).protected, false);
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Install allocation destination identity passed: ' + selected);
