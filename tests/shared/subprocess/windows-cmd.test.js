#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  quoteWindowsCmdArg,
  resolveWindowsCmdInvocation
} from '../../../src/shared/subprocess/windows-cmd.js';

assert.match(quoteWindowsCmdArg('%TEMP%'), /\^%TEMP\^%/, 'expected percent expansion to be escaped');
assert.match(quoteWindowsCmdArg('!BANG!'), /\^!BANG\^!/, 'expected delayed expansion marker to be escaped');
assert.match(quoteWindowsCmdArg('value^caret'), /\^\^/, 'expected carets to be doubled');

const invocation = resolveWindowsCmdInvocation('tool.cmd', ['alpha beta', '%TEMP%', '!BANG!', '^caret']);
assert.equal(typeof invocation.command, 'string');
assert.equal(invocation.command.toLowerCase(), (process.env.ComSpec || 'cmd.exe').toLowerCase());
assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
assert.match(invocation.args[3] || '', /tool\.cmd/, 'expected quoted wrapper command line');
assert.match(invocation.args[3] || '', /\^%TEMP\^%/, 'expected wrapper command line to preserve literal percent tokens');
assert.match(invocation.args[3] || '', /\^!BANG\^!/, 'expected wrapper command line to preserve literal bang tokens');

if (process.platform === 'win32') {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-windows-cmd-'));
  try {
    const scriptPath = path.join(tempRoot, 'echo-arg.js');
    const wrapperPath = path.join(tempRoot, 'echo-arg.cmd');
    const outputPath = path.join(tempRoot, 'arg.txt');
    const literalArg = '%TEMP%&literal!bang^caret';
    await fs.writeFile(
      scriptPath,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(outputPath)}, process.argv[2], 'utf8');\n`,
      'utf8'
    );
    await fs.writeFile(
      wrapperPath,
      `@echo off\r\nnode "%~dp0\\echo-arg.js" %*\r\n`,
      'utf8'
    );
    const runInvocation = resolveWindowsCmdInvocation(wrapperPath, [literalArg]);
    const result = spawnSync(runInvocation.command, runInvocation.args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `expected wrapper invocation to succeed: ${result.stderr || result.stdout}`);
    const captured = await fs.readFile(outputPath, 'utf8');
    assert.equal(captured, literalArg, 'expected wrapper invocation to preserve literal argument text');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

console.log('windows cmd invocation test passed');
