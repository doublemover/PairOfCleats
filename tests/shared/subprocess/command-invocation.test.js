#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveCommandInvocation,
  shouldUseCommandShimShell
} from '../../../src/shared/subprocess/command-invocation.js';

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
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('shared command invocation test passed');
