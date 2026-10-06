#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';

import {
  quoteWindowsCmdArg,
  resolveWindowsCmdShimPath,
  resolveWindowsCmdInvocation
} from '../../../src/shared/subprocess/windows-cmd.js';

const nativeFailure = (label, invocation, result) => `${label}\n${JSON.stringify({
  command: invocation.command, args: invocation.args,
  windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  status: result.status, signal: result.signal, errorCode: result.error?.code || null,
  stdout: redactDiagnosticText(String(result.stdout || ''), 1024),
  stderr: redactDiagnosticText(String(result.stderr || ''), 1024)
})}`;

assert.match(quoteWindowsCmdArg('%TEMP%'), /\^%TEMP\^%/, 'expected percent expansion to be escaped');
assert.match(quoteWindowsCmdArg('!BANG!'), /\^!BANG\^!/, 'expected delayed expansion marker to be escaped');
assert.match(quoteWindowsCmdArg('value^caret'), /\^\^/, 'expected carets to be doubled');
assert.equal(quoteWindowsCmdArg('--version'), '--version', 'simple probe arguments must remain unquoted');
assert.equal(quoteWindowsCmdArg('alpha beta'), '^"alpha^ beta^"', 'quote syntax must be escaped outside cmd quotes');
assert.equal(quoteWindowsCmdArg('alpha beta', { doubleEscape: true }), '^^^"alpha^^^ beta^^^"');
assert.equal(quoteWindowsCmdArg(''), '^"^"', 'empty argv must reach the final executable');
assert.equal(quoteWindowsCmdArg('space \\'), '^"space^ \\\\^"', 'trailing backslashes must not consume the final quote');
assert.equal(quoteWindowsCmdArg('a"b'), '^"a\\^"b^"', 'embedded quotes need executable argv and cmd escaping');
for (const count of [2, 3]) {
  assert.equal(
    quoteWindowsCmdArg(`a${'\\'.repeat(count)}"b`),
    `^"a${'\\'.repeat(count * 2 + 1)}^"b^"`,
    'every backslash before a quote must be doubled, plus the quote escape'
  );
}
for (const value of ['bad\rtext', 'bad\ntext', 'bad\0text']) {
  assert.throws(() => quoteWindowsCmdArg(value), (err) => err?.code === 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
}
const longQuoteInput = `${'\\'.repeat(50_000)}"`;
assert.equal(quoteWindowsCmdArg(longQuoteInput).length, 100_007, 'quote handling must remain linear for long backslash runs');

assert.throws(
  () => resolveWindowsCmdInvocation('tool.cmd', ['alpha beta', '%TEMP%', '!BANG!', '^caret']),
  (err) => err?.code === 'ERR_WINDOWS_CMD_NOT_FOUND',
  'expected unresolved Windows wrapper commands to fail closed'
);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc windows cmd with spaces '));
try {
  const scriptPath = path.join(tempRoot, 'echo-arg.js');
  const wrapperPath = path.join(tempRoot, 'echo-arg.cmd');
  const bareWrapperPath = path.join(tempRoot, 'npm.cmd');
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
    bareWrapperPath,
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
  const shimEnv = {
    ...process.env,
    PATH: tempRoot,
    Path: tempRoot
  };
  assert.equal(
    resolveWindowsCmdShimPath('npm', shimEnv),
    bareWrapperPath,
    'expected bare npm to resolve through PATH-backed npm.cmd shim'
  );
  const bareInvocation = resolveWindowsCmdInvocation('npm', [literalArg], shimEnv);
  assert.notEqual(
    path.basename(String(bareInvocation.command || '')).toLowerCase(),
    'npm',
    'expected bare npm shim resolution to avoid spawning the unresolved bare command token'
  );
  assert.ok(
    bareInvocation.args.includes(literalArg),
    'expected bare npm shim resolution to preserve literal argv'
  );
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
  assert.equal(opaqueInvocation.windowsVerbatimArguments, true, 'shell payload must bypass Node argv quoting');
  assert.match(opaqueInvocation.args[3], /^"[\s\S]*"$/u, 'cmd /s needs an outer payload quote pair');
  const numericWrapperPath = path.join(tempRoot, 'numeric.cmd');
  const numericWrapperBody = '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\echo-arg.js" %1\r\n';
  await fs.writeFile(numericWrapperPath, numericWrapperBody);
  const numericInvocation = resolveWindowsCmdInvocation(numericWrapperPath, [literalArg]);
  await fs.writeFile(numericWrapperPath, `@rem formerly forwarded with %*\r\n:: %* is not active forwarding here\r\n${numericWrapperBody}`);
  assert.deepEqual(
    resolveWindowsCmdInvocation(numericWrapperPath, [literalArg]),
    numericInvocation,
    'comment-only %* text must not change argument transport'
  );
  for (const inactiveForwarding of ['rem %*', ':: %*', 'echo "%*"', 'set "example=%*"', 'call nested.cmd %*', 'node "%~dp0\\echo-arg.js" "%*"', 'node "%~dp0\\echo-arg.js" %%*']) {
    await fs.writeFile(numericWrapperPath, `${inactiveForwarding}\r\n${numericWrapperBody}`);
    assert.deepEqual(resolveWindowsCmdInvocation(numericWrapperPath, [literalArg]), numericInvocation, 'other batch protocols must not masquerade as a native argv forwarder');
  }
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
  const conditionalWrapperPath = path.join(tempRoot, 'conditional.cmd');
  await fs.writeFile(
    conditionalWrapperPath,
    '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\echo-arg.js" %*\r\n',
    'utf8'
  );
  const conditionalInvocation = resolveWindowsCmdInvocation(conditionalWrapperPath, ['--version']);
  assert.equal(
    path.basename(conditionalInvocation.command).toLowerCase(),
    'cmd.exe',
    'conditional wrappers must retain their authored probe/launch control flow'
  );
  assert.equal(conditionalInvocation.windowsVerbatimArguments, true);
  const conditionalLiteralInvocation = resolveWindowsCmdInvocation(conditionalWrapperPath, [literalArg]);
  assert.ok(
    conditionalLiteralInvocation.args[3].includes('^^^"^^^%TEMP^^^%^^^&literal^^^!bang^^^^caret^^^"'),
    'forwarded argv needs two cmd parsing layers'
  );
  assert.throws(
    () => resolveWindowsCmdInvocation(conditionalWrapperPath, ['bad\necho injected']),
    (err) => err?.code === 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT',
    'shell fallbacks must reject line separators rather than execute another command'
  );
  assert.deepEqual(
    resolveWindowsCmdInvocation(wrapperPath, ['direct\nargument']).args.slice(1),
    ['direct\nargument'],
    'direct executable argv must retain its existing literal behavior'
  );
  if (process.platform === 'win32') {
    const conditionalResult = spawnSync(conditionalInvocation.command, conditionalInvocation.args, {
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: conditionalInvocation.windowsVerbatimArguments,
      encoding: 'utf8', timeout: 5000, maxBuffer: 65536
    });
    assert.equal(conditionalResult.status, 0, nativeFailure('version branch must exit successfully', conditionalInvocation, conditionalResult));
    assert.equal(conditionalResult.stderr, '', 'version branch must not hide cmd syntax errors');
    await assert.rejects(fs.access(outputPath), 'version probe must not launch the server branch');
    const conditionalLaunch = resolveWindowsCmdInvocation(conditionalWrapperPath, [literalArg]);
    const conditionalLaunchResult = spawnSync(conditionalLaunch.command, conditionalLaunch.args, {
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: conditionalLaunch.windowsVerbatimArguments,
      encoding: 'utf8', timeout: 5000, maxBuffer: 65536
    });
    assert.equal(conditionalLaunchResult.status, 0, nativeFailure('conditional server branch must launch successfully', conditionalLaunch, conditionalLaunchResult));
    assert.equal(conditionalLaunchResult.stderr, '', 'literal server branch must not hide cmd syntax errors');
    assert.equal(await fs.readFile(outputPath, 'utf8'), literalArg, 'shell fallback must preserve literal argument text');
    const allArgsPath = path.join(tempRoot, 'all-args.json');
    const allArgsScript = path.join(tempRoot, 'all-args.js');
    const allArgsWrapper = path.join(tempRoot, 'all-args.cmd');
    await fs.writeFile(allArgsScript, `require('node:fs').writeFileSync(${JSON.stringify(allArgsPath)}, JSON.stringify(process.argv.slice(2)));\n`);
    await fs.writeFile(allArgsWrapper, '@echo off\r\nif "%1"=="--version" exit /b 0\r\nnode "%~dp0\\all-args.js" %*\r\n');
    const literalArgs = [literalArg, 'alpha beta', '', 'a"b', `two${'\\'.repeat(2)}"quote`, `three${'\\'.repeat(3)}"quote`, 'space \\', '()[]|<>;,`*?', '%COMSPEC%', '!TEMP!'];
    for (let firstIndex = 0; firstIndex < literalArgs.length; firstIndex += 1) {
      const reordered = [...literalArgs.slice(firstIndex), ...literalArgs.slice(0, firstIndex)];
      const allArgsInvocation = resolveWindowsCmdInvocation(allArgsWrapper, reordered);
      const allArgsResult = spawnSync(allArgsInvocation.command, allArgsInvocation.args, {
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: allArgsInvocation.windowsVerbatimArguments,
        encoding: 'utf8', timeout: 5000, maxBuffer: 65536
      });
      assert.equal(allArgsResult.status, 0, nativeFailure(`conditional argv matrix first index ${firstIndex} must launch`, allArgsInvocation, allArgsResult));
      assert.equal(allArgsResult.stderr, '', 'successful final launch must not conceal IF argument syntax errors');
      assert.deepEqual(JSON.parse(await fs.readFile(allArgsPath, 'utf8')), reordered, 'native cmd must preserve the complete literal argv matrix');
    }
    const result = spawnSync(runInvocation.command, runInvocation.args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `expected wrapper invocation to succeed: ${result.stderr || result.stdout}`);
    const captured = await fs.readFile(outputPath, 'utf8');
    assert.equal(captured, literalArg, 'expected wrapper invocation to preserve literal argument text');
    const bareResult = spawnSync(bareInvocation.command, bareInvocation.args, {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      env: shimEnv
    });
    assert.equal(
      bareResult.status,
      0,
      `expected bare npm shim invocation to succeed: ${bareResult.stderr || bareResult.stdout}`
    );
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('windows cmd invocation test passed');
