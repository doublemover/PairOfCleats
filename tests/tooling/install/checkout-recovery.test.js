import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectCheckoutRecovery } from '../../../tools/setup/checkout-recovery.js';
import { runCheckoutBootstrap } from '../../../tools/setup/checkout-bootstrap.js';
import { diagnoseCheckout } from '../../../tools/setup/checkout-diagnose.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { inspectBootstrapReadiness, requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { CHECKOUT_JOURNAL_STATUS } from '../../../tools/setup/checkout-stage-journal.js';
import { makeBootstrapVerificationFixture } from '../../helpers/bootstrap-verification.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/checkout-recovery/')[1];
assert.ok(['intact-repeat-and-journal-recovery', 'installed-unverified-targeted-repair', 'source-versus-patch-drift',
  'locked-version-and-missing-dependency', 'lock-declarations-and-bounds', 'original-owner-and-runtime-blockers',
  'native-artifact-drift-and-no-false-readiness'].includes(mode));
const fixture = await makeBootstrapVerificationFixture(), { root, packages, write, verify } = fixture;
const declarations = Object.fromEntries(packages.map(name => [name, '1.0.0']));
const lock = { lockfileVersion: 3, packages: { '': { dependencies: declarations },
  ...Object.fromEntries(packages.map(name => ['node_modules/' + name, { version: '1.0.0' }])) } };
const inspect = async () => {
  const readiness = await inspectBootstrapReadiness({ root, probeNatives: false });
  return { readiness, recovery: inspectCheckoutRecovery({ root, readiness }) };
};
const plan = () => runCheckoutBootstrap(['locked', '--plan'], { root });
try {
  await write('package-lock.json', JSON.stringify(lock));
  if (mode === 'intact-repeat-and-journal-recovery') {
    await verify();
    assert.equal((await plan()).recovery.action, 'verify');
    const status = await fs.readFile(path.join(root, CHECKOUT_JOURNAL_STATUS));
    await fs.unlink(path.join(root, CHECKOUT_JOURNAL_STATUS));
    const { readiness, recovery } = await inspect();
    assert.equal(readiness.ready, false); assert.equal(readiness.code, 'ERR_BOOTSTRAP_JOURNAL_INCOMPLETE');
    assert.equal(recovery.action, 'verify'); assert.equal(recovery.checkedPackages, packages.length);
    assert.deepEqual((await plan()).stages.map(row => row.id), ['native-verification']);
    assert.deepEqual((await diagnoseCheckout({ root })).nextCommands, ['npm run bootstrap:ci -- --verify']);
    await write(CHECKOUT_JOURNAL_STATUS, status);
    assert.equal((await inspect()).readiness.ready, true);
  } else if (mode === 'installed-unverified-targeted-repair') {
    const selected = await plan();
    assert.equal(selected.readiness.ready, false); assert.equal(selected.recovery.action, 'repair');
    assert.deepEqual(selected.stages.map(row => row.id), ['patches', 'native-preparation']);
    assert.equal(selected.stages[1].args.at(-1), '--repair');
    const calls = [];
    // Explicit inert command adapter: this proves selection/counts, not actual
    // patches, native activation or application readiness.
    await runCheckoutBootstrap(['locked'], { root, progress: () => {}, command: async (command, args) => {
      calls.push({ command, args }); return { ok: true, status: 0, signal: null };
    } });
    assert.equal(calls.length, 2); assert.ok(calls.every(row => row.command === process.execPath));
    assert.equal(calls[1].args.at(-1), '--repair');
    assert.equal((await inspect()).readiness.ready, false, 'a successful simulated stage is never readiness');
  } else if (mode === 'source-versus-patch-drift') {
    await verify();
    const source = await fs.readFile(path.join(root, 'tools/setup/preflight.js'));
    await write('tools/setup/preflight.js', Buffer.concat([source, Buffer.from('\n// new prerequisite policy\n')]));
    assert.equal((await inspect()).readiness.ready, false);
    assert.equal((await plan()).recovery.action, 'verify', 'fresh verification can adopt new setup policy without reinstalling intact packages');
    await write('patches/fixture+1.0.0.patch', 'inert required patch metadata for selection only');
    assert.equal((await plan()).recovery.action, 'repair', 'changed patch inputs require patch application before verification');
    assert.deepEqual((await plan()).stages.map(row => row.id), ['patches', 'native-preparation']);
  } else if (mode === 'locked-version-and-missing-dependency') {
    const relative = 'node_modules/tree-sitter/package.json', original = await fs.readFile(path.join(root, relative));
    await write(relative, JSON.stringify({ name: 'tree-sitter', version: '2.0.0' }));
    assert.equal((await plan()).recovery.action, 'install');
    assert.equal((await plan()).recovery.blocker.code, 'ERR_CHECKOUT_RECOVERY_PACKAGE');
    await write(relative, original); await fs.unlink(path.join(root, relative));
    assert.equal((await plan()).recovery.action, 'install');
    assert.deepEqual((await plan()).stages.map(row => row.id), ['prerequisites', 'dependencies', 'patches', 'native-preparation']);
  } else if (mode === 'lock-declarations-and-bounds') {
    await write('package-lock.json', JSON.stringify({ ...lock, lockfileVersion: 2 }));
    assert.equal((await plan()).recovery.blocker.code, 'ERR_CHECKOUT_RECOVERY_LOCK');
    await write('package-lock.json', JSON.stringify({ ...lock, packages: { ...lock.packages, '': { dependencies: { ...declarations, unrelated: '1.0.0' } } } }));
    assert.equal((await plan()).recovery.blocker.code, 'ERR_CHECKOUT_RECOVERY_LOCK');
    await write('package-lock.json', Buffer.alloc(8 * 1024 * 1024 + 1));
    const readiness = await inspectBootstrapReadiness({ root, probeNatives: false });
    assert.equal(inspectCheckoutRecovery({ root, readiness }).blocker.code, 'ERR_CHECKOUT_RECOVERY_BOUND');
    await write('package-lock.json', JSON.stringify({ ...lock, packages: { ...lock.packages,
      'node_modules/../../outside': { version: '1.0.0' } } }));
    assert.equal((await plan()).recovery.blocker.code, 'ERR_CHECKOUT_RECOVERY_PATH');
  } else if (mode === 'original-owner-and-runtime-blockers') {
    await withCheckoutMutation(root, async () => {
      const diagnosis = await diagnoseCheckout({ root });
      assert.equal(diagnosis.recovery.action, 'wait'); assert.deepEqual(diagnosis.nextCommands, []);
      await assert.rejects(requireBootstrap({ root }), error => {
        assert.equal(error.code, 'ERR_BOOTSTRAP_REQUIRED');
        assert.equal(error.bootstrap.code, diagnosis.bootstrap.code);
        assert.deepEqual(error.bootstrap.mismatches, diagnosis.bootstrap.mismatches);
        assert.deepEqual(error.runtime, diagnosis.runtime);
        assert.deepEqual(error.recovery, diagnosis.recovery);
        assert.doesNotMatch(error.message, /npm run bootstrap/);
        return true;
      });
      let calls = 0;
      await assert.rejects(runCheckoutBootstrap(['locked'], { root, command: () => { calls++; } }), { code: 'ERR_CHECKOUT_MUTATION_BUSY' });
      assert.equal(calls, 0);
    });
    const unsupported = inspectCheckoutRecovery({ root, readiness: { code: 'ERR_BOOTSTRAP_RUNTIME_UNSUPPORTED' } });
    assert.equal(unsupported.action, 'select-runtime'); assert.equal(unsupported.command, null);
    for (const code of ['ERR_BOOTSTRAP_RECEIPT_REPLACED', 'ERR_BOOTSTRAP_JOURNAL_REPLACED']) assert.equal(
      inspectCheckoutRecovery({ root, readiness: { code } }).action, 'wait');
  } else {
    await verify();
    // Selection-only control: no placeholder native is activated. A known
    // original probe failure cannot be excused by intact file metadata.
    const unusable = inspectCheckoutRecovery({ root, readiness: { ready: false, code: 'ERR_BOOTSTRAP_NATIVE_UNUSABLE' } });
    assert.equal(unusable.action, 'repair'); assert.equal(unusable.command, 'npm run bootstrap:ci -- --repair');
    await write('node_modules/tree-sitter/fixture.node', 'changed unprobed native artifact');
    const { readiness, recovery } = await inspect();
    assert.equal(readiness.ready, false); assert.equal(recovery.action, 'repair');
    assert.match(recovery.qualification, /not-native-qualification/);
    assert.equal((await plan()).stages.some(row => row.id === 'dependencies'), false);
    await write('node_modules/tree-sitter/package.json', JSON.stringify({ name: 'tree-sitter', version: '9.0.0' }));
    assert.equal((await plan()).recovery.action, 'install', 'native repair cannot excuse a different locked package version');
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Checkout recovery reinspects actual locked manifests and selects complete existing verify, repair or install operations');
