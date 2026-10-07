#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCommand } from '../../tools/shared/cli-utils.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

if (process.platform !== 'win32') {
  console.log('cli-utils windows wrapper fallback test skipped on non-Windows platforms');
  process.exit(0);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-utils-windows-wrapper-'));
try {
  const scriptPath = path.join(tempRoot, 'fake-npm.js');
  const wrapperPath = path.join(tempRoot, 'npm.cmd');
  const outputPath = path.join(tempRoot, 'npm-output.txt');
  await fs.writeFile(
    scriptPath,
    `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(outputPath)}, process.argv.slice(2).join(' '), 'utf8');\nprocess.exit(0);\n`,
    'utf8'
  );
  await fs.writeFile(
    wrapperPath,
    '@echo off\r\nnode "%~dp0\\fake-npm.js" %*\r\n',
    'utf8'
  );

  const shimEnv = {
    ...process.env,
    PATH: tempRoot,
    Path: tempRoot
  };
  const result = runCommand('npm', ['install', '--version'], {
    env: shimEnv,
    stdio: 'pipe',
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `expected bare npm wrapper invocation to succeed: ${result.stderr}`);
  const captured = await fs.readFile(outputPath, 'utf8');
  assert.equal(captured, 'install --version', 'expected wrapper to receive original argv through bare npm path');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('cli-utils windows wrapper fallback test passed');
