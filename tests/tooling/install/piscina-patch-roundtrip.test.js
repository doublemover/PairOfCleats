import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyPatchFixture } from './patch-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('piscina-patch-roundtrip');
const patchName = 'piscina+5.3.2.patch';
const patch = (await fs.readFile(path.join('patches', patchName), 'utf8')).replace(/\r\n/g, '\n');
const sections = patch.split(/(?=^diff --git )/m).filter(Boolean);
const originals = new Map([
  ['node_modules/piscina/src/index.ts', 'd727b985a81e64f6d3afea68874c308d399e5837'],
  ['node_modules/piscina/dist/index.js', '9f142160c48edb65d5d0e96df5a2fe4a05365414']
]);
assert.equal(sections.length, originals.size);

const installed = new Map();
for (const section of sections) {
  const relative = /^diff --git a\/(\S+) b\/\S+/.exec(section)?.[1];
  assert.ok(originals.has(relative), `unexpected patch target: ${relative}`);
  const declared = /^index ([a-f0-9]+)\.\./m.exec(section)?.[1];
  assert.equal(declared, originals.get(relative).slice(0, declared?.length));
  const target = path.resolve(dir, relative);
  assert.ok(target.startsWith(path.resolve(dir) + path.sep));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = await fs.readFile(relative);
  installed.set(relative, bytes);
  await fs.writeFile(target, bytes);
}
await fs.copyFile('node_modules/piscina/package.json', path.join(dir, 'node_modules/piscina/package.json'));
await fs.mkdir(path.join(dir, 'patches'));
await fs.writeFile(path.join(dir, 'patches', patchName), patch);

const emptyConfig = path.join(dir, 'empty.gitconfig');
await fs.writeFile(emptyConfig, '');
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete gitEnv[key];
const initialized = await spawnSubprocess('git', ['-c', 'init.defaultBranch=fixture', 'init', '--quiet'],
  { cwd: dir, env: gitEnv, timeoutMs: 10000, maxOutputBytes: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
assert.equal(initialized.exitCode, 0, initialized.stderr);
const reversed = await spawnSubprocess('git', ['-c', 'core.autocrlf=false', 'apply', '--reverse', '--', path.join(dir, 'patches', patchName)],
  { cwd: dir, env: gitEnv, timeoutMs: 10000, maxOutputBytes: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
assert.equal(reversed.exitCode, 0, reversed.stderr);

for (const [relative, expectedHash] of originals) {
  const bytes = await fs.readFile(path.join(dir, relative));
  const hash = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  assert.equal(hash, expectedHash, `unpatched Piscina tarball identity differs: ${relative}`);
}
assert.equal(await applyPatchFixture(dir), originals.size);
assert.equal(await applyPatchFixture(dir, { verifyOnly: true }), originals.size);
for (const [relative, bytes] of installed) {
  assert.deepEqual(await fs.readFile(path.join(dir, relative)), bytes);
}
console.log('Piscina source and runtime patch round-trip from exact package preimages and verify after installation.');
