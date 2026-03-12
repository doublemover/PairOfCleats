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

assert.throws(
  () => resolveWindowsCmdInvocation('tool.cmd', ['alpha beta', '%TEMP%', '!BANG!', '^caret']),
  (err) => err?.code === 'ERR_WINDOWS_CMD_NOT_FOUND',
  'expected unresolved Windows wrapper commands to fail closed'
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-windows-cmd-'));
try {
  const scriptPath = path.join(tempRoot, 'echo-arg.js');
  const wrapperPath = path.join(tempRoot, 'echo-arg.cmd');
  const badWrapperPath = path.join(tempRoot, 'opaque.cmd');
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
  await fs.writeFile(
    badWrapperPath,
    '@echo off\r\necho unsupported wrapper\r\n',
    'utf8'
  );
  const fixedWrapperPath = path.join(tempRoot, 'fixed.cmd');
  await fs.writeFile(
    fixedWrapperPath,
    '@echo off\r\nnode "%~dp0\\ok.js" --mode fixed\r\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(tempRoot, 'ok.js'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    'utf8'
  );
  const runInvocation = resolveWindowsCmdInvocation(wrapperPath, [literalArg]);
  assert.notEqual(
    path.basename(runInvocation.command).toLowerCase(),
    'cmd.exe',
    'expected parseable wrappers to bypass cmd.exe fallback'
  );
  assert.ok(runInvocation.args.includes(literalArg), 'expected resolved wrapper args to preserve literal argv');
  const opaqueInvocation = resolveWindowsCmdInvocation(badWrapperPath, [literalArg]);
  assert.equal(
    path.basename(String(opaqueInvocation.command || '')).toLowerCase(),
    'cmd.exe',
    'expected opaque wrappers to fall back to an explicit cmd.exe invocation'
  );
  assert.equal(
    opaqueInvocation.args.slice(0, 3).join(' '),
    '/d /s /c',
    'expected opaque wrapper fallback to use bounded cmd.exe execution flags'
  );
  assert.match(
    String(opaqueInvocation.args[3] || ''),
    /opaque\.cmd/i,
    'expected opaque wrapper fallback payload to target the wrapper path'
  );
  const fixedInvocation = resolveWindowsCmdInvocation(fixedWrapperPath, ['--ignored']);
  assert.match(fixedInvocation.args[0] || '', /ok\.js$/i, 'expected fixed-arg wrapper to resolve its script payload');
  assert.deepEqual(
    fixedInvocation.args.slice(1),
    ['--mode', 'fixed'],
    'expected fixed-arg wrappers without %* to keep only their authored argv'
  );
  assert.equal(
    fixedInvocation.args.includes('--ignored'),
    false,
    'expected fixed-arg wrappers without %* to avoid appending caller argv'
  );
  if (process.platform === 'win32') {
    const result = spawnSync(runInvocation.command, runInvocation.args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `expected wrapper invocation to succeed: ${result.stderr || result.stdout}`);
    const captured = await fs.readFile(outputPath, 'utf8');
    assert.equal(captured, literalArg, 'expected wrapper invocation to preserve literal argument text');
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('windows cmd invocation test passed');
