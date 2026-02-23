#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  toPosix,
  fromPosix,
  isAbsolutePathAny,
  isAbsolutePathNative
} from '../../src/shared/files.js';
import {
  normalizeRepoRelativePath,
  normalizePathForRepo
} from '../../src/shared/path-normalize.js';

const isWin = process.platform === 'win32';

assert.equal(toPosix('a\\b'), 'a/b');
assert.equal(toPosix('a/b'), 'a/b');
assert.equal(toPosix(fromPosix('a/b')), 'a/b');

assert.equal(isAbsolutePathAny('C:/foo'), true);
assert.equal(isAbsolutePathAny('/tmp/foo'), true);

if (isWin) {
  assert.equal(isAbsolutePathNative('C:/foo'), true);
} else {
  assert.equal(isAbsolutePathNative('C:/foo'), false);
  assert.equal(isAbsolutePathNative('/tmp/foo'), true);
}

const repoRoot = path.resolve('repo-root');
const nestedPath = path.join(repoRoot, 'src', 'main.js');
const dotDotPrefixedName = path.join(repoRoot, '..config', 'settings.json');
assert.equal(normalizeRepoRelativePath('src/main.js', repoRoot), 'src/main.js');
assert.equal(normalizeRepoRelativePath('./src/main.js', repoRoot), 'src/main.js');
assert.equal(normalizeRepoRelativePath(nestedPath, repoRoot), 'src/main.js');
assert.equal(normalizeRepoRelativePath(dotDotPrefixedName, repoRoot), '..config/settings.json');
assert.equal(normalizeRepoRelativePath('..config/settings.json', repoRoot), '..config/settings.json');
assert.equal(normalizeRepoRelativePath('../outside.js', repoRoot), null);
assert.equal(normalizePathForRepo(nestedPath, repoRoot), 'src/main.js');
assert.equal(normalizePathForRepo(dotDotPrefixedName, repoRoot), '..config/settings.json');
assert.equal(normalizePathForRepo('src/main.js', repoRoot), 'src/main.js');

console.log('path handling helpers ok.');
