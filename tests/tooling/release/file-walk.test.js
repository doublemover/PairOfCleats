#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  collectSortedFiles,
  requireRepoContainedPath,
  resolveRepoContainedOutputPath,
  resolveRepoContainedPath
} from '../../../tools/release/file-walk.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const { dir: fixtureDir } = await prepareTestCacheDir('release-file-walk');
const root = path.join(fixtureDir, 'root');

fs.mkdirSync(path.join(root, 'z-dir'), { recursive: true });
fs.mkdirSync(path.join(root, 'a-dir'), { recursive: true });
fs.mkdirSync(path.join(root, 'B-dir'), { recursive: true });
fs.writeFileSync(path.join(root, 'z-dir', 'later.txt'), 'later');
fs.writeFileSync(path.join(root, 'a-dir', 'first.txt'), 'first');
fs.writeFileSync(path.join(root, 'B-dir', 'upper.txt'), 'upper');
fs.writeFileSync(path.join(root, 'middle.txt'), 'middle');

assert.deepEqual(
  collectSortedFiles(root).map((filePath) => path.relative(root, filePath).replace(/\\/g, '/')),
  ['B-dir/upper.txt', 'a-dir/first.txt', 'middle.txt', 'z-dir/later.txt']
);
assert.deepEqual(collectSortedFiles(path.join(fixtureDir, 'missing')), []);
assert.deepEqual(collectSortedFiles(''), []);

const contained = resolveRepoContainedPath(root, path.join(root, 'middle.txt'), 'test path');
assert.equal(contained.ok, true, 'expected absolute path inside root to be accepted');
assert.equal(contained.relative, 'middle.txt', 'expected contained path to expose POSIX relative path');

const escaping = resolveRepoContainedPath(root, path.resolve(root, '..', 'outside.txt'), 'test path');
assert.equal(escaping.ok, false, 'expected outside path to be rejected');
assert.match(
  escaping.error,
  /test path must stay within repo root/,
  'expected outside path error to explain repo-root containment'
);
assert.throws(
  () => requireRepoContainedPath(root, '..\\outside.txt', 'required path'),
  /required path must stay within repo root/,
  'expected required contained path helper to throw on escaping paths'
);

const symlinkPath = path.join(root, 'linked-dir');
try {
  fs.symlinkSync(path.join(root, 'a-dir'), symlinkPath, 'junction');
  assert.throws(
    () => collectSortedFiles(root),
    /release file walk rejects symlink entries: linked-dir/,
    'expected release file walker to reject symlinked entries before hashing artifacts'
  );
  const outputThroughSymlink = resolveRepoContainedOutputPath(
    root,
    path.join(symlinkPath, 'report.json'),
    'output path'
  );
  assert.equal(outputThroughSymlink.ok, false, 'expected output paths through symlink ancestors to be rejected');
  assert.match(
    outputThroughSymlink.error,
    /output path must not use symlink path segment: linked-dir/,
    'expected output path symlink rejection to identify the symlink segment'
  );
  assert.throws(
    () => collectSortedFiles(symlinkPath),
    /release file walk rejects symlink root/,
    'expected release file walker to reject a symlinked root before hashing artifacts'
  );
} catch (error) {
  if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
    throw error;
  }
  console.warn(`release file walk symlink assertion skipped: ${error.code}`);
}

console.log('release file walk test passed');
