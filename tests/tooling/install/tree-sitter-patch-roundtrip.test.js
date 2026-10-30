import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyPatches } from '../../../tools/setup/apply-patches.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('tree-sitter-patch-roundtrip');
const name = 'tree-sitter+0.25.1.patch';
const blobs = {
  "binding.gyp": "786d17d814e04b6574edc70e8bd0299893c99e01",
  "src/tree.cc": "32241baff0722023a97de9488cb153ce4356e94d",
  "src/language.h": "9aacb813814926e664d036482d28022464499bba",
  "src/parser.h": "4b480ba18ec83504cc644e88c22ec4dfe5cf29f3",
  "src/query.h": "a5d0431b25d1de20bb3f686da8e722c9c255e17f",
  "src/tree.h": "e086de77d58460f6db7b6f68c822357ffc8d2605",
  "src/tree_cursor.h": "8c6d63427a95648344c1090fdfdfb18d56a9c905",
  "vendor/tree-sitter/lib/src/query.c": "6c514887e0b3784d915ee982613f42157ee13458",
  "src/binding.cc": "0ccee9b8c5fa3fd9f1db42c33407a19a9cba1a8e"
};
const patch = (await fs.readFile(path.join('patches', name), 'utf8')).replaceAll('\r\n', '\n');
assert.equal(patch.match(/^diff --git /gm)?.length, Object.keys(blobs).length);
const snapshots = new Map();
for (const file of Object.keys(blobs)) {
  const relative = 'node_modules/tree-sitter/' + file;
  const value = (await fs.readFile(relative, 'utf8')).replaceAll('\r\n', '\n');
  await fs.mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
  await fs.writeFile(path.join(dir, relative), value); snapshots.set(relative, value);
}
await fs.copyFile('node_modules/tree-sitter/package.json', path.join(dir, 'node_modules/tree-sitter/package.json'));
assert.match(snapshots.get('node_modules/tree-sitter/binding.gyp'), /"MACOSX_DEPLOYMENT_TARGET": "13\.5"/u,
  'the runtime binding must match the static runtime and Node 26 macOS deployment floor');
await fs.mkdir(path.join(dir, 'patches')); await fs.writeFile(path.join(dir, 'patches', name), patch);
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
for (const [file, expected] of Object.entries(blobs)) {
  const b = await fs.readFile(path.join(dir, 'node_modules/tree-sitter', file));
  const actual = createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
  assert.equal(actual, expected, `exact locked npm package blob: ${file}`);
}
assert.equal(applyPatches(dir), Object.keys(blobs).length);
assert.equal(applyPatches(dir, { verifyOnly: true }), Object.keys(blobs).length);
for (const [relative, expected] of snapshots) assert.equal(await fs.readFile(path.join(dir, relative), 'utf8'), expected);
console.log('The complete Tree-sitter patch restores nine verified locked package blobs and reapplies exactly.');
