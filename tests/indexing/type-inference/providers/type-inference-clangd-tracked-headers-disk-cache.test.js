#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';
import {
  normalizeTrackedHeaders,
  prepareTrackedHeaderRepo
} from './tracked-headers-fixture.js';

applyTestEnv();

const { cacheDir, repoRoot } = await prepareTrackedHeaderRepo('clangd-tracked-headers-disk-cache');
const first = normalizeTrackedHeaders(repoRoot, { cacheDir });
assert.ok(first.includes('include/a.h'), 'expected tracked header listing to include include/a.h');

const cacheDirPath = path.join(cacheDir, 'clangd');
const cacheFiles = await fs.readdir(cacheDirPath);
const cacheFileName = cacheFiles.find((entry) => entry.startsWith('clangd-tracked-headers-v1-'));
assert.ok(cacheFileName, 'expected repo-scoped tracked-header cache file');
const cachePath = path.join(cacheDirPath, cacheFileName);
const cacheRaw = await fs.readFile(cachePath, 'utf8');
const cache = JSON.parse(cacheRaw);
assert.equal(typeof cache?.fingerprint, 'string', 'expected tracked-header cache fingerprint');
assert.equal(Array.isArray(cache?.paths), true, 'expected tracked-header cache paths array');
assert.equal(cache.paths?.includes('include/a.h'), true, 'expected disk cache to persist tracked headers');

console.log('clangd tracked headers disk cache test passed');
