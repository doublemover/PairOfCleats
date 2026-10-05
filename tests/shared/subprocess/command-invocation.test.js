#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

import {
  resolveCommandInvocation,
  shouldUseCommandShimShell,
  spawnResolvedSubprocess,
  spawnResolvedSubprocessSync
} from '../../../src/shared/subprocess/command-invocation.js';

// This observes option propagation only. Native cmd argv behavior is exercised
// below on Windows; a Linux child is not evidence of Windows execution.
const spawnCalls = [];
const originalSpawn = childProcess.spawn;
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawn = (command, args, options) => {
  spawnCalls.push({ kind: 'async', options });
  return originalSpawn(command, args, options);
};
childProcess.spawnSync = (command, args, options) => {
  spawnCalls.push({ kind: 'sync', options });
  return originalSpawnSync(command, args, options);
};
syncBuiltinESMExports();
try {
  spawnResolvedSubprocessSync(process.execPath, ['--version'], { windowsVerbatimArguments: true });
  await spawnResolvedSubprocess(process.execPath, ['--version'], { windowsVerbatimArguments: true });
  spawnResolvedSubprocessSync(process.execPath, ['--version']);
  assert.deepEqual(spawnCalls.map((call) => [call.kind, call.options.windowsVerbatimArguments]), [
    ['sync', true], ['async', true], ['sync', false]
  ], 'resolved invocation and both runner variants must propagate verbatim mode without enabling it by default');
} finally {
  childProcess.spawn = originalSpawn;
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
}

if (process.platform !== 'win32') {
  const invocation = resolveCommandInvocation('node', ['--version']);
  assert.equal(invocation.command, 'node', 'expected non-Windows commands to pass through unchanged');
  assert.deepEqual(invocation.args, ['--version'], 'expected non-Windows args to pass through unchanged');
  assert.equal(invocation.env, null, 'expected no invocation env on non-Windows direct execution');
  assert.equal(
    shouldUseCommandShimShell('npm', process.env),
    false,
    'expected shim shell detection to stay disabled on non-Windows'
  );
  console.log('shared command invocation test passed');
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-command-invocation-'));
try {
  const shimPath = path.join(tempRoot, 'npm.cmd');
  await fs.writeFile(shimPath, '@echo off\r\nnode "%~dp0\\noop.js" %*\r\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'noop.js'), '#!/usr/bin/env node\nprocess.exit(0);\n', 'utf8');

  const shimEnv = {
    ...process.env,
    PATH: tempRoot,
    Path: tempRoot
  };
  assert.equal(
    shouldUseCommandShimShell('npm', shimEnv),
    true,
    'expected shared shim detection to resolve bare npm through PATH-backed npm.cmd'
  );
  const invocation = resolveCommandInvocation('npm', ['install', '--version'], shimEnv);
  assert.notEqual(
    String(invocation.command || '').trim().toLowerCase(),
    'npm',
    'expected bare npm shim resolution to avoid raw unresolved command token'
  );
  assert.deepEqual(
    invocation.args.slice(-2),
    ['install', '--version'],
    'expected shared invocation helper to preserve original argv'
  );
  const argsPath = path.join(tempRoot, 'args.json');
  const forwarderPath = path.join(tempRoot, 'conditional.cmd');
  await fs.writeFile(forwarderPath, '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\capture.js" %*\r\n');
  await fs.writeFile(path.join(tempRoot, 'capture.js'), `require('node:fs').writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\n`);
  const literalArgs = ['%TEMP%&literal!bang^caret', 'alpha beta', '', 'a"b', 'space \\'];
  for (const invoke of [spawnResolvedSubprocessSync, spawnResolvedSubprocess]) {
    await invoke(forwarderPath, literalArgs, { timeoutMs: 5000 });
    assert.deepEqual(JSON.parse(await fs.readFile(argsPath, 'utf8')), literalArgs, 'shared runner must preserve literal argv through a real conditional cmd forwarder');
    await fs.rm(argsPath);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('shared command invocation test passed');
