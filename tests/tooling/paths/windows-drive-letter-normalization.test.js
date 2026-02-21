#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeWindowsDriveLetter } from '../../../src/shared/path-normalize.js';

assert.equal(
  normalizeWindowsDriveLetter('c:\\repo\\file.js'),
  'C:\\repo\\file.js',
  'expected drive letter to normalize to uppercase'
);

assert.equal(
  normalizeWindowsDriveLetter('Z:\\repo\\file.js'),
  'Z:\\repo\\file.js',
  'expected uppercase drive letter to remain unchanged'
);

assert.equal(
  normalizeWindowsDriveLetter('\\\\server\\share\\file.js'),
  '\\\\server\\share\\file.js',
  'expected non-drive UNC path to remain unchanged'
);

console.log('windows drive-letter normalization test passed');
