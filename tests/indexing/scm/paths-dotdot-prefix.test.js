#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  normalizeScmFileKey,
  toRepoPosixPath,
  toUniqueRepoPosixFiles
} from '../../../src/index/scm/paths.js';

const repoRoot = path.resolve('repo-root');
const insideDotDotPrefixed = path.join(repoRoot, '..metadata', 'file.txt');
const outsidePath = path.resolve(repoRoot, '..', 'outside', 'file.txt');

assert.equal(toRepoPosixPath(insideDotDotPrefixed, repoRoot), '..metadata/file.txt');
assert.equal(toRepoPosixPath('..metadata/file.txt', repoRoot), '..metadata/file.txt');
assert.equal(toRepoPosixPath(outsidePath, repoRoot), null);
assert.equal(normalizeScmFileKey('./src/file.js'), 'src/file.js');
assert.equal(normalizeScmFileKey('../outside.js'), null);
assert.deepEqual(
  toUniqueRepoPosixFiles(['src/a.js', './src/a.js', 'src/b.js', '../escape.js'], { repoRoot }),
  ['src/a.js', 'src/b.js'],
  'expected shared SCM unique path helper to dedupe and reject escapes'
);

console.log('scm paths dotdot-prefix test passed');
