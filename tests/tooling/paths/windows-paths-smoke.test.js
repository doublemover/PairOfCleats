#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isUncPath } from '../../../src/shared/files.js';
import { normalizePathForPlatform } from '../../../src/shared/path-normalize.js';

const mixed = 'c:/workspace\\repo//src\\index.js';
const normalized = normalizePathForPlatform(mixed, { platform: 'win32' });
assert.equal(normalized, 'C:\\workspace\\repo\\src\\index.js', 'expected mixed separators to normalize for win32');

const unc = '\\\\server/share\\repo//index.json';
const normalizedUnc = normalizePathForPlatform(unc, { platform: 'win32' });
assert.ok(normalizedUnc.startsWith('\\\\server\\share\\repo'), 'expected UNC prefix to be preserved');
assert.equal(isUncPath(normalizedUnc), true, 'expected UNC detection to succeed');

console.log('windows paths smoke test passed');
