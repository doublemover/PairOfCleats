import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('node-pty-patch-roundtrip');
const patchName = 'node-pty+1.1.0.patch';
const patch = (await fs.readFile(path.join('patches', patchName), 'utf8')).replace(/\r\n/g, '\n');
const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);
assert.equal(sections.length, 5);
const snapshots = new Map();
for (const section of sections) {
  const relative = /^diff --git a\/(\S+) b\/\S+/.exec(section)?.[1];
  assert.ok(relative?.startsWith('node_modules/node-pty/'));
  const target = path.resolve(dir, relative);
  assert.ok(target.startsWith(path.resolve(dir) + path.sep));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const value = (await fs.readFile(relative, 'utf8')).replace(/\r\n/g, '\n');
  await fs.writeFile(target, value); snapshots.set(relative, value);
}
await fs.copyFile('node_modules/node-pty/package.json', path.join(dir, 'node_modules/node-pty/package.json'));
await fs.mkdir(path.join(dir, 'patches'));
await fs.writeFile(path.join(dir, 'patches', patchName), patch);
const emptyConfig = path.join(dir, 'empty.gitconfig'); await fs.writeFile(emptyConfig, '');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete gitEnv[key];
const initialized = await spawnSubprocess('git', ['-c', 'init.defaultBranch=fixture', 'init', '--quiet'],
  { cwd: dir, env: gitEnv, timeoutMs: 10000, maxOutputBytes: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
assert.equal(initialized.exitCode, 0, initialized.stderr);
const reversed = await spawnSubprocess('git', ['-c', 'core.autocrlf=false', 'apply', '--reverse', '--', path.join(dir, 'patches', patchName)],
  { cwd: dir, env: gitEnv,
    timeoutMs: 10000, maxOutputBytes: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
assert.equal(reversed.exitCode, 0, reversed.stderr);
for (const section of sections) {
  const relative = /^diff --git a\/(\S+)/.exec(section)[1];
  const originalHash = /^index ([a-f0-9]+)\.\./m.exec(section)[1];
  const value = await fs.readFile(path.join(dir, relative));
  const hash = createHash('sha1').update(Buffer.from(`blob ${value.length}\0`)).update(value).digest('hex');
  assert.ok(hash.startsWith(originalHash), `unpatched package identity differs: ${relative}`);
}
assert.equal(applyPatches(dir), 5);
assert.equal(applyPatches(dir, { verifyOnly: true }), 5);
for (const [relative, value] of snapshots) assert.equal(await fs.readFile(path.join(dir, relative), 'utf8'), value);
console.log('The exact five-file node-pty patch applies from verified original package blobs and verifies after installation.');
