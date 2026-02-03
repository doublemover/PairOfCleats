#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isManifestPathSafe } from '../../../src/index/validate/paths.js';

const isWin = process.platform === 'win32';

assert.equal(isManifestPathSafe('C:/repo/file.txt'), !isWin);
assert.equal(isManifestPathSafe('/abs/file.txt'), false);
assert.equal(isManifestPathSafe('../escape.txt'), false);

console.log('manifest path native checks ok.');
