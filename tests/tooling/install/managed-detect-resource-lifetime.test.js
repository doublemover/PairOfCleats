#!/usr/bin/env node
// Source UNVALIDATED; fake child close/lease owner, no installed tools executed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';

const installId = 'a'.repeat(64);
const tool = { id: 'fixture-tool', toolingRoot: process.cwd(), detect: { cmd: 'fixture', args: ['prefix', '--version'] },
  managedInstallation: { command: 'fixture', args: ['prefix'], installId, descriptorId: 'b'.repeat(64) } };
let retained = false, releases = 0;
const dependencies = { locate: () => ({ found: true, path: 'fixture', source: 'located-without-probe' }),
  retain: async options => {
    assert.equal(options.installId, installId); retained = true;
    return { command: 'fixture', args: ['prefix'], root: 'fixture-root', receipt: { installId, descriptorId: 'b'.repeat(64) },
      release: () => { retained = false; releases++; return true; } };
  }, identify: () => ({ path: path.join(process.cwd(), 'fixture'), sha256: 'c'.repeat(64), size: 1 }), validate: (_tool, _command, probe) => probe,
  spawn: async (_command, args, options) => {
    assert.equal(retained, true, 'exact managed generation is pinned before the first version probe');
    assert.deepEqual(args, ['prefix', '--version'], 'managed argv prefix appears exactly once');
    options.onSpawn();
    return { exitCode: 0, stdout: 'fixture version', stderr: '' };
  } };
const result = await detectToolOwned(tool, {}, dependencies);
assert.equal(result.found, true);
assert.equal(result.installId, installId);
assert.equal(result.probe.verificationLevel, 'bounded-command-transport-and-layout');
assert.equal(retained, false);
assert.equal(releases, 1);
const cancelled = new AbortController();
cancelled.abort(new Error('fixture pre-cancelled tool detection'));
let locations = 0;
await assert.rejects(detectToolOwned(tool, { signal: cancelled.signal }, { ...dependencies,
  locate: () => { locations++; throw new Error('cancelled detection cannot locate commands'); }
}), /fixture pre-cancelled tool detection/);
assert.equal(locations, 0);

let closed = false;
const primary = Object.assign(new Error('fixture timeout without close'), { cacheOwnershipPending: true,
  cacheOwnershipReleased: () => closed, result: { termination: { closeObserved: false, treeCleanupSettled: true, treeCleanupFailed: false } } });
let retainedPrimary;
await assert.rejects(detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => { options.onSpawn(); throw primary; } }), error => {
  retainedPrimary = error; return error.cause === primary && Boolean(error.managedProbeSession);
});
assert.equal(retained, true);
assert.equal(releases, 1);
assert.throws(() => retainedPrimary.managedProbeSession.releaseAfterClosure(), /remains pending/);
closed = true;
assert.equal(retainedPrimary.managedProbeSession.releaseAfterClosure(), true);
assert.equal(releases, 2);

const limited = await detectToolOwned(tool, {}, { ...dependencies, spawn: async (_command, _args, options) => {
  options.onSpawn(); return { exitCode: 0, stdout: 'partial', outputCapture: { stdout: { truncated: true } } };
} });
assert.equal(limited.found, false, 'truncated successful output is not accepted');
assert.equal(retained, false, 'observed child close permits release after output rejection');
assert.equal(releases, 3);
await assert.rejects(detectToolOwned(tool, {}, { ...dependencies, retain: async () => ({ receipt: { installId: 'wrong' }, release: () => true }) }), /physical tool selection changed/);
console.log('Managed detection resource lifetime source fixture completed.');
