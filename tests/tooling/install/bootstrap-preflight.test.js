import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runSetupPreflight } from '../../../tools/setup/preflight.js';
import { spawnResolvedSubprocessSync } from '../../../src/shared/subprocess/command-invocation.js';
import { runNode } from '../../helpers/run-node.js';

const calls = [];
const python = JSON.stringify({ version: [3, 13, 3], executable: '/fixture/python3', releaselevel: 'final', serial: 0 });
const run = (command, args, options) => {
  calls.push({ command, args });
  assert.equal(options.timeout, 3000);
  assert.equal(options.windowsHide, true);
  const stdout = command === 'git' ? 'git version 2.50.0' : command === 'make' ? 'GNU Make 4.4'
    : command === 'c++' ? 'g++ 14.2.0' : ['python3', 'python', 'py', '/explicit/python'].includes(command) ? python : '';
  return { status: stdout ? 0 : 1, stdout };
};
const options = { nodeVersion: '26.12.1', platform: 'linux', arch: 'x64', env: {}, run };
for (const nodeVersion of ['24.0.0', '26.0.0', '26.8.1', '26.9.9', '26.10.0', '26.11.9', '26.12.0', '27.0.0', '26.12.1-rc.1', '26.10.invalid', 'unknown']) {
  calls.length = 0;
  assert.throws(() => runSetupPreflight({ ...options, nodeVersion }), /Node.js >=26.12.1 <27/);
  assert.equal(calls.length, 0, 'unsupported Node fails before any tool/install probe');
}
for (const nodeVersion of ['26.12.1', 'v26.12.1', '26.12.2', '26.13.0']) {
  assert.equal(runSetupPreflight({ ...options, nodeVersion }).python.version.join('.'), '3.13.3');
}
assert.equal(runSetupPreflight({ ...options, platform: 'darwin' }).toolchain.compiler.command, 'c++');
for (const [missing, expected] of [[['git'], /Git is missing/], [['python3', 'python'], /Python 3.6\+/],
  [['make'], /Make is required/], [['c++', 'clang++', 'g++'], /C\/C\+\+ compiler/]]) {
  assert.throws(() => runSetupPreflight({ ...options, run: (command, args, input) => missing.includes(command)
    ? { status: 1, stdout: '' } : run(command, args, input) }), expected);
}
calls.length = 0;
assert.throws(() => runSetupPreflight({ ...options, env: { NODE_GYP_FORCE_PYTHON: '/missing/python' } }), /NODE_GYP_FORCE_PYTHON/);
assert.ok(!calls.some(call => ['python3', 'python'].includes(call.command)), 'forced Python is never silently replaced');
assert.equal(runSetupPreflight({ ...options, env: { PYTHON: '/explicit/python' } }).python.executable, '/fixture/python3');
for (const key of ['npm_config_python', 'PYTHON']) {
  calls.length = 0;
  assert.throws(() => runSetupPreflight({ ...options, env: { [key]: '/missing/python' } }), new RegExp(`Explicit ${key}`));
  assert.ok(!calls.some(call => ['python3', 'python', 'py'].includes(call.command)), 'invalid explicit Python never falls through to a different install');
}
const prerelease = JSON.stringify({ version: [3, 16, 0], executable: '/fixture/python-alpha', releaselevel: 'alpha', serial: 1 });
const prereleaseRunner = (command, args, input) => ['python3', 'python', 'py', '/explicit/python'].includes(command)
  ? { status: 0, stdout: prerelease } : run(command, args, input);
assert.throws(() => runSetupPreflight({ ...options, run: prereleaseRunner }), /prerelease PATH candidates/);
assert.equal(runSetupPreflight({ ...options, env: { PYTHON: '/explicit/python' }, run: prereleaseRunner }).python.prerelease, true);
assert.throws(() => runSetupPreflight({ ...options, env: { CC: '/missing/cc' } }), /explicitly selected CC/);
assert.throws(() => runSetupPreflight({ ...options, env: { CXX: '/missing/cxx' } }), /explicitly selected CXX/);

const join = path.win32.join, vs = 'C:\\fixture\\VS2022', sdk = 'C:\\fixture\\Windows Kits\\10';
const sdkVersion = '10.0.26100.0', compilerVersion = '14.44.35207';
const vswhere = join('C:\\fixture', 'Microsoft Visual Studio/Installer/vswhere.exe');
const files = new Set([vswhere, join(vs, 'MSBuild/Current/Bin/MSBuild.exe'), join(vs, 'VC/Auxiliary/Build/vcvarsall.bat'),
  join(vs, 'VC/Tools/MSVC', compilerVersion, 'bin/Hostx64/x64/cl.exe'),
  ...['um/Windows.h', 'ucrt/stdio.h'].map(file => join(sdk, 'Include', sdkVersion, file)),
  join(sdk, 'Lib', sdkVersion, 'um/x64/kernel32.lib'), join(sdk, 'Lib', sdkVersion, 'ucrt/x64/ucrt.lib')]);
const windows = { ...options, platform: 'win32', env: { ProgramFiles: 'C:\\fixture', GYP_MSVS_VERSION: '2022' },
  exists: file => files.has(file), directories: directory => directory === join(vs, 'VC/Tools/MSVC')
    ? [compilerVersion] : directory === join(sdk, 'Include') ? [sdkVersion] : [],
  run: (command, args, input) => command === vswhere
    ? { status: 0, stdout: JSON.stringify([{ installationVersion: '17.14.0', installationPath: vs, isComplete: true }]) }
    : run(command, args, input) };
assert.equal(runSetupPreflight(windows).toolchain.sdk.version, sdkVersion);
assert.throws(() => runSetupPreflight({ ...windows, arch: 'ia32' }), /unsupported/);
assert.throws(() => runSetupPreflight({ ...windows, exists: () => false }), /Visual Studio/);
assert.throws(() => runSetupPreflight({ ...windows, env: { ...windows.env, GYP_MSVS_VERSION: '2019' } }), /Visual Studio/);
assert.throws(() => runSetupPreflight({ ...windows, env: { ...windows.env, npm_config_msvs_version: 'C:\\missing\\VS' } }), /Visual Studio/);
assert.throws(() => runSetupPreflight({ ...windows, directories: directory => directory === join(vs, 'VC/Tools/MSVC') ? [compilerVersion] : [] }), /Windows 11 SDK/);
const missingCompiler = join(vs, 'VC/Tools/MSVC', compilerVersion, 'bin/Hostx64/x64/cl.exe');
assert.throws(() => runSetupPreflight({ ...windows, exists: file => file !== missingCompiler && files.has(file) }), /Visual Studio/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-bootstrap-preflight-'));
try {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(manifest.engines.node, '>=26.12.1 <27');
  const ciNodeVersion = fs.readFileSync('.nvmrc', 'utf8').trim();
  assert.match(ciNodeVersion, /^26\.\d+\.\d+$/);
  assert.equal(runSetupPreflight({ ...options, nodeVersion: ciNodeVersion }).nodeVersion, ciNodeVersion);
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /Node\.js >=26\.12\.1 <27/);
  assert.match(readme, /Python 3 and supported C\/C\+\+[\r\n ]+build tools are mandatory/);
  assert.match(readme, /bootstrap always rebuilds the required patched Perl parser from source/);
  for (const name of ['bootstrap', 'bootstrap:ci']) {
    const commands = manifest.scripts[name].split(' && ');
    assert.equal(commands[0], 'node tools/setup/preflight.js');
    assert.equal(commands[1], `npm ${name === 'bootstrap:ci' ? 'ci' : 'install'} --include=dev --ignore-scripts`);
    assert.deepEqual(commands.slice(2), ['node tools/setup/apply-patches.js', 'node tools/setup/rebuild-native.js']);
  }
  const checkout = path.join(root, 'checkout');
  const preflight = path.join(checkout, 'tools/setup/preflight.js'), marker = path.join(root, 'installer-started');
  fs.mkdirSync(path.dirname(preflight), { recursive: true });
  fs.mkdirSync(path.join(checkout, 'src/shared'), { recursive: true });
  fs.copyFileSync('tools/setup/preflight.js', preflight);
  fs.copyFileSync('src/shared/direct-execution.js', path.join(checkout, 'src/shared/direct-execution.js'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  // An empty PATH is not a portable proof that system tools are unavailable.
  // Select an explicit missing-command fixture runner in this dependency-free
  // child; the real CLI's dependency-free argument guard is checked separately.
  const fixtureEntry = path.join(root, 'explicit-missing-tool-fixture.mjs');
  fs.writeFileSync(fixtureEntry, `import { runSetupPreflight } from './checkout/tools/setup/preflight.js';
    try { runSetupPreflight({ run(command) {
      if (command !== 'git') throw new Error('Unexpected probe after missing Git');
      return { status: null, error: { code: 'ENOENT' } };
    } }); } catch (error) { console.error(error.message); process.exitCode = 1; }`);
  const shell = process.platform === 'win32' ? path.join(root, 'explicit-fixture-bootstrap.cmd') : '/bin/sh';
  if (process.platform === 'win32') fs.writeFileSync(shell, '@echo off\r\n"%~1" "%~2" && echo installed>"%~3"\r\n');
  const args = process.platform === 'win32' ? [process.execPath, fixtureEntry, marker]
    : ['-c', '"$1" "$2" && printf installed > "$3"', 'preflight', process.execPath, fixtureEntry, marker];
  const env = { ...process.env, PATH: '', Path: '' };
  const result = spawnResolvedSubprocessSync(shell, args, { cwd: root, env, encoding: 'utf8', timeoutMs: 5000, rejectOnNonZeroExit: false });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /bootstrap preflight.*Git is missing/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.equal(fs.existsSync(marker), false, 'failed dependency-free preflight stops the install chain');
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  const cli = runNode([preflight, '--unexpected'], 'dependency-free preflight CLI argument rejection', root, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /Usage: node tools\/setup\/preflight.js/);
  assert.doesNotMatch(cli.stderr, /ERR_MODULE_NOT_FOUND/);
  // macOS /var -> /private/var and checkout directory links must execute the
  // same prerequisite checks. This alias contains only this disposable copy.
  const alias = path.join(root, 'checkout-alias');
  fs.symlinkSync(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const aliased = runNode([path.join(alias, 'tools/setup/preflight.js'), '--unexpected'],
    'dependency-free preflight through directory alias', root, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  assert.equal(aliased.status, 1, 'directory alias must not bypass the actual CLI');
  assert.match(aliased.stderr, /Usage: node tools\/setup\/preflight.js/);
  assert.doesNotMatch(aliased.stderr, /ERR_MODULE_NOT_FOUND/);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Bootstrap preflight rejects unsupported Node/missing tools before installation, discovers supported platform prerequisites and runs without dependencies.');
