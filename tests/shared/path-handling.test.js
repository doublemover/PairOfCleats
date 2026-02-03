#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  toPosix,
  fromPosix,
  isAbsolutePathAny,
  isAbsolutePathNative
} from '../../src/shared/files.js';

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

console.log('path handling helpers ok.');
