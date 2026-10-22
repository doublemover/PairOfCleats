#!/usr/bin/env node
// Source UNVALIDATED; fake resources exercise ownership, never installed tools.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withStructuralBinary } from '../../../src/experimental/structural/execution.js';
import { runStructuralSearch } from '../../../src/experimental/structural/runner.js';
import { runBinary } from '../../../src/experimental/structural/binaries.js';

const installId = 'a'.repeat(64);
const command = path.join(process.cwd(), 'fixture-structural-command');
let pinned = false;
let releases = 0;
let attempts = 0;
const dependencies = {
  getConfig: () => ({ dir: process.cwd() }),
  resolveTools: () => [{ id: 'ast-grep', managedInstallation: { command, installId, descriptorId: 'b'.repeat(64) } }],
  locate: () => ({ found: true, path: command }),
  identify: () => ({ path: command, sha256: 'c'.repeat(64), size: 1 }),
  retain: async options => {
    assert.equal(options.installId, installId);
    pinned = true;
    return { command, args: ['fixture-prefix'], root: path.dirname(command), receipt: { installId }, release: () => { pinned = false; releases++; return true; } };
  },
  spawn: async (_command, args, options) => {
    assert.equal(pinned, true, 'identity probes and rule children must both hold exact installation');
    assert.equal(options.timeoutMs, attempts++ === 0 ? 5000 : undefined, 'rules have no implicit five second deadline');
    options.onSpawn();
    return { exitCode: 0, stdout: args.includes('--version') ? 'ast-grep 0.40.4' : '[]', stderr: '' };
  }
};
await withStructuralBinary('ast-grep', { repoRoot: process.cwd() }, async scope => {
  assert.equal(scope.installId, installId);
  await scope.run(['scan']);
  assert.equal(pinned, true);
}, dependencies);
assert.equal(releases, 1);
assert.equal(pinned, false);
assert.throws(() => runBinary({ requiresOwnedExecution: true }, []), { code: 'ERR_STRUCTURAL_OWNER_REQUIRED' });

let actualClosure = false;
const primary = Object.assign(new Error('fixture child did not close'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => actualClosure,
  result: { termination: { closeObserved: false, treeCleanupSettled: true, treeCleanupFailed: false } }
});
await assert.rejects(withStructuralBinary('ast-grep', { repoRoot: process.cwd() }, async scope => scope.run(['scan']), {
  ...dependencies, spawn: async (_command, args, options) => {
    options.onSpawn();
    if (args.includes('--version')) return { exitCode: 0, stdout: 'ast-grep 0.40.4' };
    throw primary;
  }
}), error => error === primary);
assert.equal(pinned, true, 'timeout response alone cannot release installation');
assert.equal(releases, 1);
assert.throws(() => primary.structuralInstallationSession.releaseAfterClosure(), /remains pending/);
actualClosure = true;
assert.equal(primary.structuralInstallationSession.releaseAfterClosure(), true);
assert.equal(releases, 2);

const cancelled = new AbortController();
await assert.rejects(withStructuralBinary('ast-grep', { repoRoot: process.cwd(), signal: cancelled.signal }, async scope => {
  cancelled.abort(new Error('fixture cancelled before rule spawn'));
  return scope.run(['scan']);
}, { ...dependencies, spawn: async (_command, _args, options) => { options.onSpawn(); return { exitCode: 0, stdout: 'ast-grep 0.40.4' }; } }), /fixture cancelled/);
assert.equal(pinned, false, 'prelaunch cancellation releases a settled identity probe');

await assert.rejects(runStructuralSearch({ repoRoot: process.cwd(), packsToRun: [{ engine: 'semgrep', rules: ['inert'] }] },
  async (_engine, _options, execute) => execute({ run: async () => ({ status: null, stdout: '' }) })), { code: 'ERR_STRUCTURAL_TOOL' });
console.log('Structural managed execution lifetime source fixture completed.');
