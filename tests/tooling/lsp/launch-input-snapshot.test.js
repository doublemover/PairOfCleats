import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { resolveWindowsCmdInvocation, resolveWindowsCmdShimPath } from '../../../src/shared/subprocess/windows-cmd.js';
import { resolveCommandInvocation } from '../../../src/shared/subprocess/command-invocation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual client launch boundary; an inert spawn observer throws
// before dispatch. No console, shell, real child or fake live transport is made.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['arguments', 'environment', 'cwd', 'relative-wrapper', 'relative-path', 'processor',
  'system-root', 'client-wrapper', 'hidden', 'restart-isolation', 'invalid-arguments'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`lsp-launch-snapshot-${selected}`);
const wrapper = path.join(dir, 'inert-wrapper.cmd');
// Conditional wrapper must stay opaque; this fixture must exercise cmd-host
// resolution rather than the existing straight-line Node-wrapper optimization.
await fs.writeFile(wrapper, '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\server.js" %*\r\n');
const env = { ...process.env, FIXTURE_LAUNCH: 'original', PATH: dir,
  ComSpec: path.join(dir, 'selected-cmd.exe'), COMSPEC: path.join(dir, 'selected-cmd.exe') };
const originalCwd = process.cwd(), beforeComSpec = process.env.ComSpec, beforeCOMSPEC = process.env.COMSPEC;
const sentinel = new Error('inert observer before actual spawn');
const args = ['--stdio'], observed = [];
const options = { cmd: process.execPath, args, cwd: dir, env, spawnProcess(input) {
  observed.push({ ...input, environmentBefore: { ...input.options.env } });
  if (selected === 'restart-isolation') input.options.env.FIXTURE_LAUNCH = 'observer mutation';
  throw sentinel;
} };
try {
  if (selected === 'invalid-arguments') {
    for (const value of [['bad\0argument'], [7], {}]) assert.throws(() => createLspClient({ ...options, args: value }), TypeError);
    assert.equal(observed.length, 0);
  } else if (['relative-wrapper', 'relative-path', 'processor', 'system-root'].includes(selected)) {
    process.env.ComSpec = path.join(dir, 'ambient-cmd.exe'); process.env.COMSPEC = process.env.ComSpec;
    const selectedEnv = { ...env };
    if (selected === 'system-root') {
      delete selectedEnv.ComSpec; delete selectedEnv.COMSPEC; selectedEnv.SystemRoot = path.join(dir, 'selected-system');
    }
    const name = selected === 'relative-wrapper' ? './inert-wrapper.cmd' : 'inert-wrapper.cmd';
    if (selected === 'relative-path') selectedEnv.PATH = '.';
    const invocation = resolveWindowsCmdInvocation(name, args, selectedEnv, { cwd: dir });
    assert.equal(invocation.command, selected === 'system-root'
      ? path.join(selectedEnv.SystemRoot, 'System32', 'cmd.exe') : env.ComSpec);
    assert.equal(resolveWindowsCmdShimPath(name, selectedEnv, { cwd: dir }), wrapper);
    assert.ok(invocation.args.at(-1).includes('inert-wrapper.cmd'));
    if (process.platform === 'win32') assert.deepEqual(resolveCommandInvocation(name, args, selectedEnv, { cwd: dir }), invocation);
  } else {
    if (selected === 'cwd') { options.cwd = '.'; process.chdir(dir); }
    if (selected === 'client-wrapper') { options.cmd = 'inert-wrapper.cmd'; options.shell = true; }
    const client = createLspClient(options);
    args.push('--late-argument'); env.FIXTURE_LAUNCH = 'caller mutation'; env.PATH = path.join(dir, 'absent');
    env.ComSpec = path.join(dir, 'caller-cmd.exe'); env.COMSPEC = env.ComSpec;
    if (selected === 'cwd') process.chdir(originalCwd);
    assert.throws(() => client.start(), error => error === sentinel);
    const launch = observed[0]; assert.ok(launch);
    assert.deepEqual(launch.rawArgs, ['--stdio']); assert.equal(launch.environmentBefore.FIXTURE_LAUNCH, 'original');
    assert.equal(launch.options.cwd, dir); assert.equal(launch.options.windowsHide, true); assert.equal(launch.options.shell, false);
    if (selected === 'client-wrapper') assert.equal(launch.cmd, path.join(dir, 'selected-cmd.exe'));
    if (selected === 'restart-isolation') {
      assert.throws(() => client.start(), error => error === sentinel);
      assert.notEqual(observed[0].options.env, observed[1].options.env);
      assert.equal(observed[1].environmentBefore.FIXTURE_LAUNCH, 'original');
      assert.equal(observed[1].options.env.PATH, dir);
      assert.deepEqual(observed[1].rawArgs, ['--stdio']);
    }
    assert.equal(client.getTerminationEvidence().settled, true, 'no child was dispatched or left owned');
  }
} finally {
  process.chdir(originalCwd);
  if (beforeComSpec === undefined) delete process.env.ComSpec; else process.env.ComSpec = beforeComSpec;
  if (beforeCOMSPEC === undefined) delete process.env.COMSPEC; else process.env.COMSPEC = beforeCOMSPEC;
  assert.ok(path.resolve(dir).startsWith(path.resolve(path.dirname(dir)) + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`LSP launch input snapshot: ${selected}`);
