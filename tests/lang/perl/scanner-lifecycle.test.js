import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { runSetupPreflight } from '../../../tools/setup/preflight.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('perl-scanner-lifecycle');
const pkg = path.join(root, 'node_modules/@ganezdragon/tree-sitter-perl');
await fs.copyFile(path.join(pkg, 'src/scanner.c'), path.join(dir, 'perl-scanner-under-test.c'));
await fs.copyFile(new URL('./scanner-lifecycle.fixture.c', import.meta.url), path.join(dir, 'fixture.c'));
const binary = path.join(dir, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
const invoke = async (command, args) => {
  const result = await spawnSubprocess(command, args, { cwd: dir, timeoutMs: 15000,
    maxOutputBytes: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
  return result;
};
if (process.platform === 'win32') {
  const { toolchain } = runSetupPreflight();
  const msvc = path.join(toolchain.compiler.installationPath, 'VC/Tools/MSVC', toolchain.compiler.version);
  const sdk = toolchain.sdk;
  await invoke(toolchain.compiler.executable, ['/nologo', '/std:c11', '/W3', '/WX', '/Od',
    '/I' + path.join(msvc, 'include'), '/I' + path.join(sdk.root, 'Include', sdk.version, 'ucrt'),
    '/I' + path.join(pkg, 'src'), '/Fe' + binary, '/Fo' + path.join(dir, 'fixture.obj'), 'fixture.c',
    '/link', '/LIBPATH:' + path.join(msvc, 'lib', process.arch),
    '/LIBPATH:' + path.join(sdk.root, 'Lib', sdk.version, 'ucrt', process.arch),
    '/LIBPATH:' + path.join(sdk.root, 'Lib', sdk.version, 'um', process.arch)]);
} else {
  await invoke('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O0', '-I', path.join(pkg, 'src'),
    'fixture.c', '-o', binary]);
}
const result = await invoke(binary, []);
assert.match(result.stdout, /ownership, state restoration, literal delimiters and bounds passed/);
console.log(result.stdout.trim());
