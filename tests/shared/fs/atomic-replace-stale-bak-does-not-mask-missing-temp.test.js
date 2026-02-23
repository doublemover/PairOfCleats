#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'atomic-replace-stale-bak-missing-temp');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'target.json');
const bakPath = `${finalPath}.bak`;
const missingTempPath = path.join(outDir, 'target.tmp');

await fsPromises.writeFile(finalPath, 'current-final', 'utf8');
await fsPromises.writeFile(bakPath, 'stale-backup', 'utf8');
const staleAt = new Date(Date.now() - 60_000);
await fsPromises.utimes(finalPath, staleAt, staleAt);

let failed = null;
try {
  await replaceFile(missingTempPath, finalPath, { keepBackup: false });
} catch (err) {
  failed = err;
}

assert.ok(failed, 'expected replaceFile to fail when temp path is missing');
assert.equal(failed?.code, 'ERR_TEMP_MISSING', 'expected ERR_TEMP_MISSING for missing temp path');
assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'current-final', 'expected final file to remain unchanged');
assert.equal(fs.existsSync(bakPath), true, 'expected stale backup to remain untouched on failure');

console.log('atomic replace stale .bak missing-temp guard test passed');
