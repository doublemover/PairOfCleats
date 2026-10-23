#!/usr/bin/env node
// Source authored for the frozen integration batch. All child adapters below
// explicitly select inert trusted fixture commands; no vendor tool is run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { withOperationalTool } from '../../../tools/tooling/operational-execution.js';

const temporary = await makeTempDir('poc-operational-owner-');
try {
  const repoRoot = path.join(temporary, 'repo');
  await fs.mkdir(repoRoot);
  const command = path.join(repoRoot, 'explicit-trusted-ripgrep-fixture');
  await fs.writeFile(command, 'inert fixture executable bytes, never executed');
  const toolingRoot = path.join(temporary, 'tools'), installId = 'a'.repeat(64);
  const tool = { id: 'ripgrep', authorityRepoRoot: repoRoot, toolingRoot,
    detect: { cmd: command, args: ['--version'] }, prerequisites: [],
    managedInstallation: { command, args: [], descriptorId: 'b'.repeat(64), installId } };
  let releases = 0, runs = 0;
  const dependencies = {
    getConfig: () => ({ dir: toolingRoot }), resolveTools: () => [tool],
    retain: async () => ({ command, args: [], root: repoRoot, receipt: { installId }, release: () => { releases++; return true; } }),
    spawn: async (selected, args, options) => {
      assert.equal(selected, command, 'only the explicitly selected trusted fixture command reaches the adapter');
      assert.equal(options.env.RUSTUP_AUTO_INSTALL, '0');
      runs++;
      if (args[0] === '--version') return { exitCode: 0, stdout: 'ripgrep 15.2.0\n' };
      if (args[0] === '--json') return { exitCode: 0, stdout: JSON.stringify({ type: 'match', data: { lines: { text: 'pairofcleats-rg-probe\n' } } }) + '\n' };
      return { exitCode: 0, stdout: 'src/file.js\n' };
    }
  };
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]', PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => {
    await assert.rejects(withOperationalTool('ripgrep', { repoRoot }, () => assert.fail('untrusted repo wrapper cannot execute'), dependencies),
      { code: 'ERR_OPERATIONAL_TOOL_UNAVAILABLE' });
    assert.equal(runs, 0); assert.equal(releases, 0);
  });
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repoRoot]), PAIROFCLEATS_TRUSTED_CONFIG: null }, async () => {
    let escaped;
    const value = await withOperationalTool('ripgrep', { repoRoot }, async selected => {
      assert.equal(releases, 0, 'version and capability probes retain the generation into the consumer');
      assert.equal(selected.installId, installId);
      escaped = selected.run;
      const result = await selected.run(['--files']);
      assert.equal(releases, 0, 'actual consumer close precedes release');
      return result.stdout;
    }, dependencies);
    assert.equal(value, 'src/file.js\n'); assert.equal(releases, 1); assert.equal(runs, 3);
    assert.throws(() => escaped(['--files']), /scope is closed/);
    await assert.rejects(withOperationalTool('ripgrep', { repoRoot, commandOverride: path.join(repoRoot, 'absent-explicit-command') },
      () => assert.fail('explicit missing selection cannot fall back'), dependencies), { code: 'ERR_OPERATIONAL_TOOL_UNAVAILABLE' });
    assert.equal(runs, 3);

    let settled = false;
    const pending = Object.freeze(Object.assign(new Error('actual fixture child remains pending'), {
      cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
    }));
    let failure;
    try { await withOperationalTool('ripgrep', { repoRoot }, () => assert.fail('pending probe cannot enter the consumer'),
      { ...dependencies, spawn: async () => { throw pending; } }); }
    catch (error) { failure = error; }
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(releases, 1, 'a frozen child failure retains its exact installation');
    const session = failure.managedInstallSession;
    assert.throws(() => session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), /pending/);
    settled = true;
    assert.equal(session.releaseAfterSettlement({ resourceId: session.resourceId, settled: true, pending: false }), true);
    assert.equal(releases, 2);

    const changed = { ...dependencies, spawn: async (selected, args, options) => {
      const result = await dependencies.spawn(selected, args, options);
      if (args[0] === '--files') await fs.writeFile(command, 'changed bytes with the same displayed version');
      return result;
    } };
    await assert.rejects(withOperationalTool('ripgrep', { repoRoot }, selected => selected.run(['--files']), changed), { code: 'ERR_OPERATIONAL_TOOL_CHANGED' });
    assert.equal(releases, 3, 'confirmed child closure releases the generation even when its bytes drift');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Operational consumers reject untrusted/changed selections and retain exact managed generations through child settlement.');
