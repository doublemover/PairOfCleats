import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { qualifyInstalledLspRuntime } from '../../../tools/ci/qualify-lsp-runtime.js';
import { probeLspInitializeHandshake } from '../../../src/index/tooling/command-resolver.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../../src/shared/kill-tree.js';

const cases = ['success', 'unexpected-stderr', 'unresponsive-initialize', 'unresponsive-shutdown',
  'diagnostics-truncated', 'observer-throw', 'untrusted-command', 'version-timeout', 'fixture-without-testing',
  'phpactor-info', 'phpactor-unexpected-stderr', 'phpactor-duplicate-info'];
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/ci/lsp-runtime-qualification/')[1];
assert.ok(cases.includes(selected));
const providerId = selected.startsWith('phpactor-') ? 'phpactor' : 'csharp-ls';
const { dir } = await prepareIsolatedTestCacheDir(`lsp-runtime-qualification-${selected}`);
initGitRepo(dir);
const bin = path.join(dir, 'bin'); await fs.mkdir(bin);
const marker = path.join(dir, 'invoked'), pidFile = path.join(dir, 'server-pid');
const versionPidFile = path.join(dir, 'version-pid');
const program = path.join(bin, 'explicit-runtime-fixture.mjs');
const stub = new URL('../../fixtures/lsp/stub-lsp-server.js', import.meta.url).href;
const mode = selected === 'unresponsive-initialize' ? 'stall-initialize'
  : selected === 'unresponsive-shutdown' ? 'stall-shutdown' : 'csharp';
await fs.writeFile(program, `import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(marker)}, 'invoked\\n');
const selected=${JSON.stringify(selected)};
if(process.argv.includes('--version')) {
  if(selected==='version-timeout' && fs.readFileSync(${JSON.stringify(marker)},'utf8').trim().split('\\n').length===2) {
    fs.writeFileSync(${JSON.stringify(versionPidFile)}, String(process.pid));
    await new Promise(resolve=>setTimeout(resolve,4250));
  }
  process.stdout.write('explicit runtime fixture v1.0.0\\n');
}
else {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  if(selected.startsWith('phpactor-')) process.stderr.write('Starting language server, use -vvv for verbose output\\n');
  if(selected==='phpactor-duplicate-info') process.stderr.write('Starting language server, use -vvv for verbose output\\n');
  if(selected==='phpactor-unexpected-stderr') process.stderr.write('explicit unclassified fixture diagnostic\\n');
  if(selected==='unexpected-stderr'||selected==='observer-throw') process.stderr.write('explicit unclassified fixture diagnostic\\n');
  if(selected==='diagnostics-truncated') for(let i=0;i<70;i++) process.stderr.write('explicit unclassified fixture diagnostic '+i+'\\n');
  process.argv.push('--mode', ${JSON.stringify(mode)});
  await import(${JSON.stringify(stub)});
}\n`);
const command = path.join(bin, process.platform === 'win32' ? 'explicit-runtime.cmd' : 'explicit-runtime');
if (process.platform === 'win32') {
  const quote = value => `"${value.replace(/%/g, '%%')}"`;
  await fs.writeFile(command, `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quote(process.execPath)} ${quote(program)} %*\r\n`);
} else {
  const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
  await fs.writeFile(command, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(program)} "$@"\n`, { mode: 0o755 });
}
const qualificationWorkspace = path.join(dir, 'diagnostics', '.lsp-qualification', providerId);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(selected === 'untrusted-command' ? [] : [dir, qualificationWorkspace])
} });
await withTemporaryEnv(env, async () => {
  try {
    if (selected === 'observer-throw') {
      const observed = { stderr: false, lifecycle: false, metrics: false };
      const fail = name => () => { observed[name] = true; throw new Error('Injected diagnostic observer failure'); };
      const result = await probeLspInitializeHandshake({ providerId: 'csharp-ls', cmd: command, args: [], cwd: dir,
        toolingConfig: { dir: path.join(dir, 'tooling') }, timeoutMs: 4000,
        onStderrLine: fail('stderr'), onLifecycleEvent: fail('lifecycle'), onMetrics: fail('metrics') });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(observed, { stderr: true, lifecycle: true, metrics: true });
    } else {
      const qualify = () => qualifyInstalledLspRuntime({ providerId, repoRoot: dir,
        toolingConfig: { dir: path.join(dir, 'tooling') }, diagnosticsDir: path.join(dir, 'diagnostics'),
        fixture: { command, versionPrefix: 'explicit runtime fixture v1.0.0' } });
      const result = selected === 'fixture-without-testing'
        ? await withTemporaryEnv({ PAIROFCLEATS_TESTING: undefined, PAIROFCLEATS_TEST_CONFIG: undefined }, qualify)
        : await qualify();
      assert.equal(result.ok, ['success', 'phpactor-info'].includes(selected), JSON.stringify(result));
      if (selected === 'fixture-without-testing') {
        assert.equal(result.receipt, null);
        assert.equal(result.process.exitCode, 1);
        assert.match(result.process.stderr, /Explicit fixture commands require the test environment/);
        await assert.rejects(fs.access(marker), { code: 'ENOENT' }, 'non-testing qualification cannot execute fixture commands');
        return;
      } else if (['success', 'phpactor-info'].includes(selected)) {
        assert.equal(result.receipt.workspace, qualificationWorkspace, 'the simulated protocol uses only its explicitly granted fixture workspace');
        assert.equal(result.process.exitCode, 0);
        assert.equal(result.process.stderr, '');
        assert.equal(result.receipt.evidence, 'explicit-simulated-command');
        assert.equal(result.receipt.metrics.byMethod.shutdown.succeeded, 1);
        assert.ok(result.receipt.events.some(event => event.kind === 'exit' && event.code === 0));
      } else if (selected === 'untrusted-command') {
        assert.equal(result.receipt.reason, 'command_probe_failed');
        await assert.rejects(fs.access(marker), { code: 'ENOENT' }, 'untrusted commands cannot run even a version probe');
        return;
      } else if (selected === 'version-timeout') {
        assert.equal(result.receipt.reason, 'version_identity_failed');
        assert.equal(result.receipt.version.ok, false);
        assert.equal(result.receipt.version.outcome, 'timeout', 'late successful output cannot hide the original timeout');
        const pid = Number(await fs.readFile(versionPidFile, 'utf8'));
        assert.equal(isProcessAlive(pid), false, 'the actual slow version descendant is reaped');
        await assert.rejects(fs.access(pidFile), { code: 'ENOENT' }, 'failed version qualification never launches the protocol server');
        return;
      } else {
        const reason = { 'unexpected-stderr': 'unexpected_stderr', 'diagnostics-truncated': 'diagnostics_truncated',
          'phpactor-unexpected-stderr': 'unexpected_stderr', 'phpactor-duplicate-info': 'unexpected_stderr',
          'unresponsive-initialize': 'initialize_failed', 'unresponsive-shutdown': 'shutdown_not_acknowledged' }[selected];
        assert.ok(result.receipt.reasons.includes(reason), JSON.stringify(result));
        assert.ok(result.receipt.reaped.every(item => !item.alive));
        if (selected === 'unresponsive-shutdown') {
          assert.equal(result.receipt.result.ok, true, 'initialize-only success is insufficient for runtime qualification');
          assert.equal(result.receipt.metrics.byMethod.shutdown.timedOut, 1);
        }
      }
    }
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.equal(isProcessAlive(pid), false, 'the actual simulated server descendant is reaped');
  } finally {
    for (const markerFile of [pidFile, versionPidFile]) {
      const pid = Number(await fs.readFile(markerFile, 'utf8').catch(() => ''));
      if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) await killProcessTree(pid);
    }
  }
});
console.log(`Explicit simulated LSP runtime qualification case ${selected} retains strict process/protocol/diagnostic boundaries`);
