import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('perl-patch-roundtrip');
const name = '@ganezdragon+tree-sitter-perl+1.1.1.patch';
const relative = 'node_modules/@ganezdragon/tree-sitter-perl/src/scanner.c';
const patch = (await fs.readFile(path.join('patches', name), 'utf8')).replaceAll('\r\n', '\n');
assert.equal(patch.match(/^diff --git /gm)?.length, 1);
assert.ok(patch.startsWith(`diff --git a/${relative} b/${relative}\n`));
const source = (await fs.readFile(relative, 'utf8')).replaceAll('\r\n', '\n');
await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
await fs.writeFile(path.join(dir, relative), source);
await fs.copyFile('node_modules/@ganezdragon/tree-sitter-perl/package.json',
  path.join(dir, 'node_modules/@ganezdragon/tree-sitter-perl/package.json'));
await fs.mkdir(path.join(dir, 'patches'));
await fs.writeFile(path.join(dir, 'patches', name), patch);
const config = path.join(dir, 'empty.gitconfig'); await fs.writeFile(config, '');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
const git = async args => {
  const result = await spawnSubprocess('git', args, { cwd: dir, env, timeoutMs: 10000,
    maxOutputBytes: 65536, stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
  assert.equal(result.exitCode, 0, result.stderr);
};
await git(['-c', 'init.defaultBranch=fixture', 'init', '--quiet']);
await git(['-c', 'core.autocrlf=false', 'apply', '--reverse', '--', path.join(dir, 'patches', name)]);
const original = await fs.readFile(path.join(dir, relative));
const blob = createHash('sha1').update(Buffer.from(`blob ${original.length}\0`)).update(original).digest('hex');
assert.equal(blob, '58b5c4050ac4f5baae6055e5697365cc0f256b63',
  'reverse must restore the exact scanner from the integrity-verified locked npm tarball');
assert.equal(applyPatches(dir), 1);
assert.equal(applyPatches(dir, { verifyOnly: true }), 1);
assert.equal(await fs.readFile(path.join(dir, relative), 'utf8'), source);
console.log('The Perl patch restores the exact locked scanner blob and reapplies completely.');
