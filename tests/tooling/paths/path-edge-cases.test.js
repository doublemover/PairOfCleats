#!/usr/bin/env node
import assert from 'node:assert/strict';
import { joinPathSafe, normalizePathForPlatform } from '../../../src/shared/path-normalize.js';

const normalized = normalizePathForPlatform('..\\unsafe\0path/segment', { platform: 'posix' });
assert.equal(normalized.includes('\0'), false, 'expected NUL bytes to be stripped');

const escaped = joinPathSafe('/tmp/pairofcleats', ['..', 'outside', 'file.txt'], { platform: 'posix' });
assert.equal(escaped, null, 'expected traversal join to be rejected');

const safe = joinPathSafe('/tmp/pairofcleats', ['inside', 'file.txt'], { platform: 'posix' });
assert.equal(safe, '/tmp/pairofcleats/inside/file.txt', 'expected safe join to resolve inside root');

const normalizedWindows = normalizePathForPlatform('C:/repo//a+b\\\\file.js', { platform: 'win32' });
assert.equal(
  normalizedWindows,
  'C:\\repo\\a+b\\file.js',
  'expected Windows normalization to preserve plus characters and collapse duplicate separators'
);

const normalizedLongWindows = normalizePathForPlatform('\\\\?\\c:\\repo\\src\\file.js', { platform: 'win32' });
assert.equal(
  normalizedLongWindows,
  '\\\\?\\C:\\repo\\src\\file.js',
  'expected long-path drive letter to normalize to uppercase'
);

const normalizedPosixDoubleSlash = normalizePathForPlatform('//host//share///folder/file.js', { platform: 'posix' });
assert.equal(
  normalizedPosixDoubleSlash,
  '//host/share/folder/file.js',
  'expected posix normalization to preserve double-slash root semantics'
);

console.log('path edge-cases test passed');
