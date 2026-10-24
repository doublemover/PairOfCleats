import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createToolProvisioningPlan, verifyToolProvisioningPlan, probeProvisioningCommand } from '../../../tools/tooling/provisioning-plan.js';
import { isProvisioningObservationFailure } from '../../../tools/tooling/provisioning-failure.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual plan/byte owners, inert injected probe boundaries only.
// No executable, spawn, installer, native binding, child, IPC or network runs.
const caught = action => {
  let failed = false, error;
  try { action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
for (const value of [undefined, null, false, 0, '']) {
  const report = await probeProvisioningCommand('inert-selected-command', [], { spawn: async () => { throw value; } });
  assert.deepEqual(report, { ok: false, outcome: 'spawn-error', status: null, signal: null, errorCode: null, stdout: '', stderr: '' });
}
{
  let settled = false, metadataReads = 0;
  const result = Object.freeze(Object.defineProperties({ exitCode: 0 }, {
    cacheOwnershipPending: { value: false },
    cacheOwnershipReleased: { value() { assert.equal(this, result); return settled; } },
    outputCapture: { get() { metadataReads += 1; throw new Error('pending returned work cannot inspect another report'); } }
  }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => result }));
  assert.equal(metadataReads, 0); assert.equal(failure.cacheOwnershipReleased(), false);
  assert.throws(() => Object.defineProperty(failure, 'cacheOwnershipReleased', { value: () => true }), TypeError);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
for (const marker of [undefined, false, true]) {
  let settled = false, calls = 0;
  const primary = Object.assign(new Error('original prerequisite probe retains native work'), {
    ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
    cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
  });
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => { calls += 1; throw primary; } }));
  assert.equal(contains(failure, primary), true); assert.equal(isProvisioningObservationFailure(failure), true);
  primary.cacheOwnershipReleased = () => true;
  assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(calls, 1);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
{
  let settled = false;
  const original = function () { assert.equal(this, primary); return settled; };
  let reads = 0;
  const primary = Object.freeze(Object.defineProperty(new Error('observer getter changes after first capture'), 'cacheOwnershipReleased', {
    get() { reads += 1; return reads === 1 ? original : () => true; }
  }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => { throw primary; } }));
  assert.equal(failure.cacheOwnershipReleased(), false, 'a replacement getter cannot erase the actual first observation');
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
for (const value of [undefined, null, false, 0, '']) {
  const primary = Object.freeze(Object.defineProperty(new Error('original diagnostic classification'), 'code', { get() { throw value; } }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => { throw primary; } }));
  assert.equal(failure.cause, primary); assert.equal(failure.errors[1].cause, value);
  assert.equal(Object.hasOwn(failure.errors[1], 'cause'), true);
}
{
  let settled = false;
  const inspection = Object.assign(new Error('diagnostic result getter retains another owner'), {
    cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
  });
  const primary = Object.freeze(Object.defineProperty(new Error('original failed command'), 'result', { get() { throw inspection; } }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => { throw primary; } }));
  assert.equal(contains(failure, inspection), true); inspection.cacheOwnershipReleased = () => true;
  assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}
{
  let settled = false;
  const inspection = Object.freeze(Object.assign(new Error('unreadable native observation inspection'), {
    cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
  }));
  const primary = Object.freeze(Object.defineProperty(new Error('unknown native observation'), 'cacheOwnershipPending', { get() { throw inspection; } }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => { throw primary; } }));
  assert.equal(contains(failure, inspection), true); settled = true;
  assert.equal(failure.cacheOwnershipReleased(), false, 'unreadable original remains unknown after secondary settlement');
}
{
  const timeout = Object.freeze(Object.assign(new Error('closed timeout'), { name: 'SubprocessTimeoutError', code: 'ETIMEDOUT',
    cacheOwnershipPending: true, cacheOwnershipReleased() { return this === timeout; },
    result: { exitCode: 0, signal: 'SIGTERM', stdout: 'bounded stdout', stderr: 'bounded stderr' } }));
  assert.deepEqual(await probeProvisioningCommand('inert', [], { spawn: async () => { throw timeout; } }), {
    ok: false, outcome: 'timeout', status: 0, signal: 'SIGTERM', errorCode: 'ETIMEDOUT', stdout: 'bounded stdout', stderr: 'bounded stderr'
  });
}
for (const value of [undefined, null, false, 0, '']) {
  const result = Object.freeze(Object.defineProperty({ exitCode: 0 }, 'outputCapture', { get() { throw value; } }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => result }));
  assert.equal(failure.cause, result); assert.equal(failure.errors[1].cause, value);
  assert.equal(isProvisioningObservationFailure({ provisioningFailurePhase: 'prerequisite-probe-result' }), false);
}
{
  let settled = true;
  const result = Object.freeze(Object.defineProperties({ stdout: 'v26.12.1' }, {
    cacheOwnershipReleased: { value() { assert.equal(this, result); return settled; } },
    exitCode: { get() { settled = false; return 0; } }
  }));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { spawn: async () => result }));
  assert.equal(failure.cacheOwnershipReleased(), false);
  settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
}

const root = await makeTempDir('poc-provisioning-failure-');
const realpath = fs.realpathSync;
try {
  const selected = path.join(root, 'selected-runtime'); fs.writeFileSync(selected, 'typed runtime fixture bytes, never executed');
  const tool = { id: 'failure-runtime-fixture', prerequisites: [{ id: 'node', command: selected, family: 'node', phase: 'launch', dependsOn: [] }] };
  const selection = { scope: 'cache', plan: null };
  for (const value of [undefined, null, false, 0, '']) {
    fs.realpathSync = (file, ...args) => { if (file === selected) throw value; return realpath(file, ...args); };
    const plan = createToolProvisioningPlan({ tool, selection, probe: () => assert.fail('failed byte admission cannot probe') });
    assert.equal(plan.steps[0].state, 'missing'); assert.equal(plan.steps[0].errorCode, 'ERR_PREREQUISITE_BYTES');
  }
  for (const marker of [undefined, false, true]) {
    let settled = false;
    const original = Object.assign(new Error('actual executable selection observation pending'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: marker }),
      cacheOwnershipReleased() { assert.equal(this, original); return settled; }
    });
    fs.realpathSync = (file, ...args) => { if (file === selected) throw original; return realpath(file, ...args); };
    const failure = caught(() => createToolProvisioningPlan({ tool, selection }));
    original.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  fs.realpathSync = realpath;
  const preview = createToolProvisioningPlan({ tool, selection });
  for (const mode of ['sync', 'async']) {
    let settled = false, probes = 0;
    const result = Object.assign({ ok: true, stdout: 'v26.12.1' }, {
      cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, result); return settled; }
    });
    const probe = () => { probes += 1; return result; };
    const failure = mode === 'sync' ? caught(() => createToolProvisioningPlan({ tool, selection, probe }))
      : await rejected(() => verifyToolProvisioningPlan(preview, { probe }));
    assert.equal(probes, 1); result.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const mode of ['sync', 'async']) {
    let settled = true, afterProbe = false, probes = 0;
    const identityFailure = Object.freeze(Object.assign(new Error('exact post-probe byte identity observation failed'), { code: 'EIO' }));
    const result = Object.assign({ ok: true, stdout: 'v26.12.1' }, {
      cacheOwnershipReleased() { assert.equal(this, result); return settled; }
    });
    fs.realpathSync = (file, ...args) => {
      if (file === selected && afterProbe) { settled = false; throw identityFailure; }
      return realpath(file, ...args);
    };
    const probe = () => { probes += 1; afterProbe = true; return result; };
    const failure = mode === 'sync' ? caught(() => createToolProvisioningPlan({ tool, selection, probe }))
      : await rejected(() => verifyToolProvisioningPlan(preview, { probe }));
    assert.equal(contains(failure, identityFailure), true); assert.equal(contains(failure, result), true);
    assert.equal(failure.message, identityFailure.message); assert.equal(probes, 1);
    result.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
    fs.realpathSync = realpath;
  }
  for (const mode of ['sync', 'async']) {
    let settled = false, probes = 0;
    const inspection = Object.assign(new Error('runtime verification getter retained another owner'), {
      cacheOwnershipReleased() { assert.equal(this, inspection); return settled; }
    });
    const result = Object.freeze(Object.defineProperty({ ok: true }, 'stdout', { get() { throw inspection; } }));
    const probe = () => { probes += 1; return result; };
    const failure = mode === 'sync' ? caught(() => createToolProvisioningPlan({ tool, selection, probe }))
      : await rejected(() => verifyToolProvisioningPlan(preview, { probe }));
    assert.equal(contains(failure, result), true); assert.equal(contains(failure, inspection), true); assert.equal(probes, 1);
    inspection.cacheOwnershipReleased = () => true;
    assert.equal(failure.cacheOwnershipReleased(), false); settled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  {
    const failure = caught(() => createToolProvisioningPlan({ tool, selection, probe: () => Promise.resolve({ ok: true, stdout: 'v26.12.1' }) }));
    assert.equal(failure.cacheOwnershipReleased(), false, 'a Promise cannot establish synchronous/native settlement');
  }
  const cancelled = new AbortController(); cancelled.abort(new Error('exact prerequisite cancellation'));
  const failure = await rejected(() => probeProvisioningCommand('inert', [], { signal: cancelled.signal,
    spawn: async () => { throw Object.freeze(new Error('original rejected command during cancellation')); } }));
  assert.equal(failure.message, 'original rejected command during cancellation');
} finally { fs.realpathSync = realpath; await rmDirRecursive(root); }
console.log('Actual prerequisite owners preserve original resources through diagnostic classification.');
