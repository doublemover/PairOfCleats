// Source regression authored for the development batch; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { runBootstrap } from '../../../tools/setup/bootstrap.js';

const root = await makeTempDir('bootstrap-owned-cancellation-');
try {
  await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify({ tooling: { autoInstallOnDetect: true } }));
  await withTemporaryEnv({ PAIROFCLEATS_TESTING: '1', PAIROFCLEATS_CACHE_ROOT: path.join(root, 'cache'),
    PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TEST_CONFIG: '', PAIROFCLEATS_TRUSTED_CONFIG: '',
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([root]) }, async () => {
    const options = { repo: root, json: true, 'skip-dicts': true, 'skip-artifacts': true };
    const cancelled = new AbortController();
    cancelled.abort(new Error('inert pre-cancelled bootstrap'));
    let admissions = 0;
    const before = await runBootstrap(options, { signal: cancelled.signal, log: () => {}, command: async () => { admissions++; } });
    assert.equal(before.summary.lifecycle.state, 'cancelled');
    assert.equal(admissions, 0);

    for (const childSignal of ['SIGINT', 'SIGTERM']) {
      const outcome = await runBootstrap(options, { log: () => {}, command: async () => {
        admissions++;
        return { ok: false, status: null, signal: childSignal, stdout: '', stderr: '' };
      } });
      assert.equal(outcome.exitCode, childSignal === 'SIGINT' ? 130 : 143);
      assert.equal(outcome.summary.errors[0].status, null);
      assert.equal(outcome.summary.errors[0].signal, childSignal);
      assert.equal(outcome.summary.steps.index, undefined, 'a signalled detector cannot admit an index build');
    }

    const calls = [];
    const pending = Object.assign(new Error('inert installer child close unconfirmed'), { cacheOwnershipPending: true });
    const result = await runBootstrap(options, { log: () => {}, command: async (_command, args) => {
      calls.push(args);
      if (args[0].endsWith('detect.js')) return { ok: true, status: 0, stdout: JSON.stringify({ tools: [{ id: 'pyright', found: false }] }) };
      if (args[0].endsWith('install.js')) throw pending;
      throw new Error('a later build must not be admitted');
    } });
    assert.equal(result.summary.lifecycle.state, 'settlement-pending');
    assert.equal(result.summary.lifecycle.step, 'tooling');
    assert.equal(result.summary.steps.index, undefined);
    assert.equal(result.summary.steps.tooling.detectParsed, undefined, 'pending installation is outside the detection parse catch');
    assert.equal(calls.length, 2);
    assert.equal(calls[1][calls[1].indexOf('--tools') + 1], 'pyright', 'only selected missing tools are handed off for installation');
    assert.equal(result.exitCode, 1);

    await fs.writeFile(path.join(root, '.pairofcleats.json'), JSON.stringify({ tooling: { autoInstallOnDetect: false } }));
    const noInstall = [];
    const disabled = await runBootstrap({ ...options, 'skip-index': true }, { log: () => {}, command: async (_command, args) => {
      noInstall.push(args);
      return { ok: true, status: 0, stdout: JSON.stringify({ tools: [{ id: 'pyright', found: false }] }) };
    } });
    assert.equal(disabled.summary.steps.tooling.status, 'not-requested');
    assert.equal(noInstall.length, 1, 'auto-install disabled cannot trigger a separate unconditional Pyright ensure');
  });
} finally { await rmDirRecursive(root); }
console.log('Bootstrap preserves cancellation and pending child settlement before later admissions.');
