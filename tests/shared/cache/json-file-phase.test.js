#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBoundedJsonFile, loadBoundedJsonFileSync } from '../../../src/shared/cache/json-file.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-json-cache-file-'));
const invalidPath = path.join(tempRoot, 'invalid.json');
await fsPromises.writeFile(invalidPath, '{bad-json', 'utf8');

const syncInvalid = loadBoundedJsonFileSync(invalidPath, { fallback: null, maxBytes: 1024 });
assert.equal(syncInvalid.data, null, 'expected sync parser failure fallback');
assert.equal(syncInvalid.phase, 'parse', 'expected sync parse phase classification');
assert.ok(syncInvalid.error, 'expected sync parser error metadata');

const asyncInvalid = await loadBoundedJsonFile(invalidPath, { fallback: null, maxBytes: 1024 });
assert.equal(asyncInvalid.data, null, 'expected async parser failure fallback');
assert.equal(asyncInvalid.phase, 'parse', 'expected async parse phase classification');
assert.ok(asyncInvalid.error, 'expected async parser error metadata');

const oversizedPath = path.join(tempRoot, 'oversized.json');
fs.writeFileSync(oversizedPath, '{"payload":"' + 'x'.repeat(8192) + '"}', 'utf8');
const syncOversized = loadBoundedJsonFileSync(oversizedPath, { fallback: null, maxBytes: 64 });
assert.equal(syncOversized.data, null, 'expected sync oversized fallback payload');
assert.equal(syncOversized.phase, 'stat', 'expected sync oversize to be classified at stat phase');
assert.equal(syncOversized.error?.code, 'ERR_JSON_FILE_TOO_LARGE', 'expected sync oversize error code');

const missingPath = path.join(tempRoot, 'missing.json');
const asyncMissing = await loadBoundedJsonFile(missingPath, { fallback: null, maxBytes: 64 });
assert.equal(asyncMissing.data, null, 'expected async missing file fallback payload');
assert.equal(asyncMissing.phase, 'stat', 'expected async missing file to be stat-phase classified');
assert.equal(asyncMissing.error?.code, 'ENOENT', 'expected async missing file ENOENT classification');

console.log('shared cache json file phase test passed');
