#!/usr/bin/env node
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolveWindowsCmdInvocation } from '../../src/shared/subprocess/windows-cmd.js';

const nativeWindows = process.platform === 'win32';
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
const originalSpawnSync = childProcess.spawnSync;
const originalPath = process.env.PATH;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc structural wrappers & '));
const repoRoot = path.join(tempRoot, 'repo with spaces %PATH% !PATH!');
const capturePath = path.join(tempRoot, 'captured.json');
const markerPath = path.join(tempRoot, 'injected.txt');
const rulePath = path.join(repoRoot, 'rule with spaces.json');
const literalArgs = [
  'alpha beta', '', '%PATH%', '!PATH!', '^caret', 'a"b',
  `two${'\\'.repeat(2)}"quote`, 'space \\', '()[]|<>;,`*?',
  `literal&echo injected>"${markerPath}"`
];
const unsafeArgs = ['bad\ntext', 'bad\rtext', 'bad\0text'];
const calls = [];

try {
  await fs.mkdir(repoRoot);
  await fs.writeFile(path.join(tempRoot, 'capture.cjs'),
    `require('node:fs').writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(process.argv.slice(2)));\n`);
  const straightWrapper = path.join(tempRoot, 'straight.cmd');
  await fs.writeFile(straightWrapper, '@echo off\r\nnode "%~dp0\\capture.cjs" %*\r\n');
  const wrappers = ['comby.cmd', 'comby.bat'].map((name) => path.join(tempRoot, name));
  for (const wrapper of wrappers) {
    // Keep a real branch so the shared resolver cannot bypass cmd.exe.
    await fs.writeFile(wrapper,
      '@echo off\r\nif exist "%~dp0skip-launch" exit /b 7\r\nnode "%~dp0\\capture.cjs" %*\r\n');
  }
  const relativeDir = path.join(repoRoot, 'relative wrappers');
  const relativeWrapper = path.join(relativeDir, 'relative-tool.cmd');
  await fs.mkdir(relativeDir);
  await fs.copyFile(path.join(tempRoot, 'capture.cjs'), path.join(relativeDir, 'capture.cjs'));
  await fs.copyFile(wrappers[0], relativeWrapper);
  const relativeLaunches = [
    { command: path.join('relative wrappers', 'relative-tool.cmd'), options: { cwd: repoRoot } },
    { command: 'relative-tool.cmd', options: { cwd: pathToFileURL(`${relativeDir}${path.sep}`) } },
    {
      command: 'relative-tool.cmd', options: {
        cwd: repoRoot,
        env: { ...process.env, PATH: `relative wrappers${path.delimiter}${path.dirname(process.execPath)}` }
      }
    }
  ];
  const rule = {
    id: 'literal-rule', language: '.js',
    pattern: 'alpha beta %PATH% !PATH! ^caret',
    rewrite: `replacement&echo injected>"${markerPath}"`
  };
  await fs.writeFile(rulePath, JSON.stringify(rule));
  process.env.PATH = `${tempRoot}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${originalPath || ''}`;

  // This section checks transport only. Native Windows execution below is the
  // evidence that cmd.exe preserves argv; a Linux mock cannot establish that.
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, signal: null, stdout: '', stderr: '' };
  };
  syncBuiltinESMExports();
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' });
  const { runBinary } = await import('../../src/experimental/structural/binaries.js');
  const { runStructuralSearch } = await import('../../src/experimental/structural/runner.js');
  Object.defineProperty(process, 'platform', platformDescriptor);

  for (const wrapper of wrappers) {
    const argsPrefix = ['--fixture-prefix'];
    const expected = resolveWindowsCmdInvocation(wrapper, [...argsPrefix, ...literalArgs]);
    assert.equal(path.basename(expected.command).toLowerCase(), 'cmd.exe', 'fixture must exercise shell fallback');
    const result = runBinary({ command: wrapper, argsPrefix }, literalArgs, { shell: true, timeoutMs: 1000 });
    assert.equal(result.status, 0);
    const observed = calls.at(-1);
    assert.deepEqual(observed.args, expected.args, 'structural tools must use the shared Windows transport');
    assert.equal(observed.command, expected.command);
    assert.equal(observed.options.windowsVerbatimArguments, true);
    assert.equal(observed.options.shell, false);
    assert.equal(observed.options.timeout, 1000);
    assert.ok(observed.args[3].includes('"alpha beta"'), 'space-containing argv needs quoting');
    assert.ok(observed.args[3].includes('^^^%PATH^^^%'), 'batch forwarding needs expansion protection');
    for (const value of unsafeArgs) {
      const callCount = calls.length;
      const rejected = runBinary(wrapper, [value]);
      assert.equal(rejected.error?.code, 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
      assert.equal(rejected.status, null);
      const rejectedPrefix = runBinary({ command: wrapper, argsPrefix: [value] }, []);
      assert.equal(rejectedPrefix.error?.code, 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
      assert.equal(calls.length, callCount, 'unsafe shell text must fail before spawning');
    }
  }
  const callsBeforeMissing = calls.length;
  assert.equal(runBinary(path.join(tempRoot, 'missing.cmd'), []).error?.code, 'ERR_WINDOWS_CMD_NOT_FOUND');
  assert.equal(calls.length, callsBeforeMissing, 'missing wrappers must fail closed');
  for (const { command, options } of relativeLaunches) {
    assert.equal(runBinary(command, literalArgs, options).status, 0);
    const expected = resolveWindowsCmdInvocation(relativeWrapper, literalArgs);
    assert.equal(calls.at(-1).command, expected.command);
    assert.deepEqual(calls.at(-1).args, expected.args, 'relative wrapper lookup must use the child cwd');
    assert.equal(calls.at(-1).options.cwd, options.cwd, 'spawn cwd must remain unchanged');
  }

  const directArgs = [...literalArgs, 'literal\nnewline'];
  runBinary(straightWrapper, directArgs, { windowsVerbatimArguments: true });
  assert.equal(calls.at(-1).command, process.execPath, 'straight-line shim should bypass the shell');
  assert.deepEqual(calls.at(-1).args.slice(1), directArgs);
  assert.equal(calls.at(-1).options.windowsVerbatimArguments, false, 'direct argv must use Node quoting');
  runBinary({ command: process.execPath, argsPrefix: ['--fixture-prefix'] }, directArgs);
  assert.equal(calls.at(-1).command, process.execPath);
  assert.deepEqual(calls.at(-1).args, ['--fixture-prefix', ...directArgs], 'ordinary executable argv must remain literal');
  assert.equal(calls.at(-1).options.shell, false);

  const request = { repoRoot, packsToRun: [{ engine: 'comby', rules: [rulePath] }] };
  const expectedCombyArgs = ['-json-lines', '-matcher', rule.language, rule.pattern, rule.rewrite, repoRoot];
  assert.deepEqual(runStructuralSearch(request), []);
  assert.deepEqual(calls.at(-1).args, resolveWindowsCmdInvocation(wrappers[0], expectedCombyArgs).args,
    'repository rule language, pattern, rewrite and root must use protected transport');
  for (const field of ['language', 'pattern', 'rewrite']) {
    const callCount = calls.length;
    await fs.writeFile(rulePath, JSON.stringify({ ...rule, [field]: 'bad\necho injected' }));
    assert.throws(() => runStructuralSearch(request), (error) => error.code === 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
    assert.equal(calls.length, callCount, `unsafe repository rule ${field} must not launch a process`);
  }
  await fs.writeFile(rulePath, JSON.stringify(rule));
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();

  if (nativeWindows) {
    const assertCaptured = async (command, args, expected = args, options = {}) => {
      await fs.rm(capturePath, { force: true });
      const result = runBinary(command, args, {
        encoding: 'utf8', timeoutMs: 5000, windowsHide: true, maxBuffer: 65536, ...options
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, `native structural launch failed: ${result.stderr}`);
      assert.equal(result.stderr, '', 'successful launch must not conceal cmd syntax errors');
      assert.deepEqual(JSON.parse(await fs.readFile(capturePath, 'utf8')), expected);
      await assert.rejects(fs.access(markerPath), 'rule text must not execute another command');
    };
    for (const wrapper of wrappers) {
      await assertCaptured({ command: wrapper, argsPrefix: ['--fixture-prefix'] }, literalArgs,
        ['--fixture-prefix', ...literalArgs]);
      await fs.rm(capturePath);
      for (const value of unsafeArgs) {
        assert.equal(runBinary(wrapper, [value]).error?.code, 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
      }
      await assert.rejects(fs.access(capturePath), 'rejected shell arguments must not launch the fixture');
      await fs.writeFile(path.join(tempRoot, 'skip-launch'), 'guard');
      const guarded = runBinary(wrapper, ['--version'], { timeoutMs: 5000 });
      assert.equal(guarded.status, 7, 'opaque wrapper control flow must be preserved');
      await assert.rejects(fs.access(capturePath), 'guarded wrapper must not launch the fixture');
      await fs.rm(path.join(tempRoot, 'skip-launch'));
    }
    for (const { command, options } of relativeLaunches) {
      await assertCaptured(command, literalArgs, literalArgs, options);
    }
    await assertCaptured(straightWrapper, directArgs);
    await assertCaptured({ command: process.execPath, argsPrefix: [path.join(tempRoot, 'capture.cjs')] }, directArgs);
    await fs.rm(capturePath);
    assert.deepEqual(runStructuralSearch(request), []);
    assert.deepEqual(JSON.parse(await fs.readFile(capturePath, 'utf8')), expectedCombyArgs,
      'native Comby-rule transport must preserve all repository-controlled fields');
    await assert.rejects(fs.access(markerPath), 'native Comby rule must not execute injected command text');
    for (const field of ['language', 'pattern', 'rewrite']) {
      await fs.rm(capturePath, { force: true });
      await fs.writeFile(rulePath, JSON.stringify({ ...rule, [field]: 'bad\necho injected' }));
      assert.throws(() => runStructuralSearch(request), (error) => error.code === 'ERR_WINDOWS_CMD_UNSAFE_ARGUMENT');
      await assert.rejects(fs.access(capturePath), `unsafe native rule ${field} must not launch the fixture`);
    }
    console.log('structural Windows wrapper native execution test passed');
  } else {
    console.log('structural Windows wrapper native execution skipped (Windows only)');
  }
} finally {
  Object.defineProperty(process, 'platform', platformDescriptor);
  childProcess.spawnSync = originalSpawnSync;
  syncBuiltinESMExports();
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('structural Windows wrapper transport contract passed');
