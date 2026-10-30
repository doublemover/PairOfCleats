import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSetupPreflight } from '../../tools/setup/preflight.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';

/** Build only this fixed fault injector in the original disposable fixture. */
export const prepareWindowsStdoutCloser = async ({ root, dir }) => {
  assert.equal(process.platform, 'win32');
  const output = path.join(dir, 'stdout-close');
  await fs.mkdir(output);
  for (const file of ['binding.gyp', 'stdout-close.c']) {
    await fs.copyFile(path.join(root, 'tests/fixtures/windows/stdout-close', file), path.join(output, file));
  }
  const preflight = runSetupPreflight();
  const result = await spawnSubprocess(process.execPath,
    [path.join(root, 'node_modules/node-gyp/bin/node-gyp.js'), 'rebuild', '--jobs=1',
      '--devdir=' + path.join(root, '.cache/native-build/headers'), '--target=' + process.versions.node],
    { cwd: output, env: { ...process.env, ...preflight.childEnv }, timeoutMs: 10000,
      maxOutputBytes: 128 * 1024, rejectOnNonZeroExit: false, windowsHide: true });
  await fs.writeFile(path.join(dir, 'stdout-close-build.json'), JSON.stringify(result, null, 2));
  assert.equal(result.exitCode, 0, result.stderr);
  return path.join(output, 'build/Release/stdout_close.node');
};
