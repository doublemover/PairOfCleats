#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveWindowsCmdInvocation as resolveSharedInvocation } from '../../../src/shared/subprocess/windows-cmd.js';

const require = createRequire(import.meta.url);
const {
  resolveWindowsCmdInvocation,
  resolveWindowsCmdShimPath
} = require('../../../extensions/vscode/windows-cmd.js');

const args = ['alpha&beta', '%TEMP%', '!VALUE!', '^caret'];
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-vscode-windows-cmd-'));
try {
  const wrapperPath = path.join(tempRoot, 'echo-arg.cmd');
  const bareWrapperPath = path.join(tempRoot, 'npm.cmd');
  await fs.writeFile(
    wrapperPath,
    '@echo off\r\nnode "%~dp0\\echo-arg.js" %*\r\n',
    'utf8'
  );
  await fs.writeFile(
    bareWrapperPath,
    '@echo off\r\nnode "%~dp0\\echo-arg.js" %*\r\n',
    'utf8'
  );
  const shared = resolveSharedInvocation(wrapperPath, args);
  const extension = resolveWindowsCmdInvocation(wrapperPath, args);
  assert.deepEqual(extension, shared, 'expected VS Code wrapper invocation to match shared Windows cmd escaping');
  const shimEnv = {
    ...process.env,
    PATH: tempRoot,
    Path: tempRoot
  };
  assert.equal(
    resolveWindowsCmdShimPath('npm', shimEnv),
    bareWrapperPath,
    'expected VS Code mirror to expose shared bare shim PATH resolution'
  );
  assert.deepEqual(
    resolveWindowsCmdInvocation('npm', args, shimEnv),
    resolveSharedInvocation('npm', args, shimEnv),
    'expected VS Code bare shim invocation to match shared Windows cmd behavior'
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('vscode windows cmd helper test passed');
