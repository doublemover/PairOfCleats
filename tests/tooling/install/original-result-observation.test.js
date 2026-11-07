import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runToolInstallChild } from '../../../tools/tooling/install-execution.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// Real storage sessions/reservations; controlled original observations, not an
// actual package installation, OS handle leak or live child-close qualification.
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/original-result-observation/')[1];
assert.ok(['returned-result-observation', 'error-before-diagnostics', 'field-interval-observation', 'ordinary-results-and-falsy-errors'].includes(mode));
const scope = path.resolve('.tmp/tasks/install-observation'); await fs.mkdir(scope, { recursive: true });
const root = await fs.mkdtemp(path.join(scope, 'case-')), marker = randomUUID();
await fs.writeFile(path.join(root, '.owned-test-fixture'), marker);
const layout = resolveStorageLayout({ home: path.join(root, 'home'), env: {} });
// Actual installer artifacts occupy their own destination, beside child assets.
// Reserving the whole tooling category here also reserves those nested assets a
// second time and correctly refuses this fixture's deliberately small budget.
const artifactRoot = path.join(layout.descriptors.tooling.path, 'fixture-artifacts');
const coordinationRoot = path.join(layout.descriptors.state.path, 'storage-access');
let ready = mode === 'field-interval-observation', resultReads = 0, laterReads = 0, calls = 0;
const pending = [];
const invoke = async spawn => {
  const plan = planManagedChildStorage({ baseEnv: {}, layout, family: 'npm', managed: true,
    toolId: 'fixture', toolIdentity: 'original-fields-v1', runId: 'run-' + ++calls });
  const destinations = [...new Set([artifactRoot, ...plan.locations.map(location => location.file ? path.dirname(location.path) : location.path)])];
  const admission = { writes: destinations.map(root => ({ root, requiredBytes: 96 * 1024, hardBytes: 128 * 1024 })) };
  return runToolInstallChild({ command: 'explicit-inert-fixture', args: [], options: { cwd: plan.cwd }, storagePlan: plan, layout,
    artifactRoot, admission, spawn });
};
const observe = value => Object.defineProperties(value, { cacheOwnershipPending: { value: false },
  cacheOwnershipReleased: { value: function () { assert.equal(this, value); return ready; } } });
try {
  if (mode === 'ordinary-results-and-falsy-errors') {
    const normal = await invoke(async (_command, _args, options) => { options.onSpawn(); return { exitCode: 0, signal: null, stdout: 'ok', stderr: '' }; });
    assert.equal(normal.ok, true); assert.equal(normal.stdout, 'ok'); assert.equal(normal.settlement.settled, true);
    const primary = Object.assign(new Error('ordinary closed child failure'), { result: { exitCode: 9, signal: null,
      stdout: 'partial', stderr: 'failed', termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } } });
    const failed = await invoke(async (_command, _args, options) => { options.onSpawn(); throw primary; });
    assert.equal(failed.ok, false); assert.equal(failed.status, 9); assert.equal(failed.stdout, 'partial'); assert.equal(failed.error, primary);
    for (const original of [undefined, null, false, 0, '']) {
      const result = await invoke(async () => { throw original; });
      assert.equal(result.ok, false); assert.equal(result.settlement.settled, true); assert.ok(errorGraphIncludes(result.error, original));
    }
    assert.equal((await inspectStorageAccess(artifactRoot, { coordinationRoot })).protected, false);
  } else {
    let original;
    if (mode === 'error-before-diagnostics') {
      original = observe(new Error('original child remains pending'));
      Object.defineProperty(original, 'result', { get() { resultReads++; ready = true; return { termination: { closeObserved: true, treeCleanupSettled: true, treeCleanupFailed: false } }; } });
      Object.freeze(original);
    } else {
      original = observe({ stdout: '', stderr: '' });
      Object.defineProperties(original, { exitCode: { get() { resultReads++; if (mode === 'field-interval-observation') ready = false; return 0; } },
        signal: { get() { laterReads++; ready = true; return null; } } }); Object.freeze(original);
    }
    await assert.rejects(invoke(async (_command, _args, options) => {
      options.onSpawn(); if (mode === 'error-before-diagnostics') throw original; return original;
    }), error => { pending.push(error); return errorGraphIncludes(error, original); });
    assert.equal(resultReads, mode === 'field-interval-observation' ? 1 : 0, 'unknown original work is checked before any diagnostic read');
    assert.equal(laterReads, 0, 'a later field cannot erase the pending interval');
    assert.equal((await inspectStorageAccess(artifactRoot, { coordinationRoot })).protected, true,
      'original action/result observations reach the real metadata owner before automatic release');
  }
} finally {
  ready = true;
  for (const failure of pending) {
    const session = failure.storageSession; assert.ok(session, 'the original storage recovery owner is retained');
    const receipt = { resourceId: session.resourceId, settled: true, pending: false, cacheOwnershipReleased: () => ready };
    if (failure.managedChildAdmissionSession) await failure.managedChildAdmissionSession.releaseAfterSettlement(receipt);
    for (const reservation of failure.storageWriteReservations || []) await reservation.releaseAfterSettlement(receipt);
    session.releaseAfterSettlement(receipt);
  }
  const physicalScope = await fs.realpath(scope), physicalRoot = await fs.realpath(root);
  assert.ok(isPathWithinRoot(physicalRoot, physicalScope) && physicalRoot !== physicalScope);
  assert.equal(await fs.readFile(path.join(physicalRoot, '.owned-test-fixture'), 'utf8'), marker);
  await fs.rm(physicalRoot, { recursive: true, force: true });
}
console.log('Installer result projection preserves original observations before settlement and per-field diagnostics.');
