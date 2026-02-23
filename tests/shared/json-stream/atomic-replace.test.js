#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFile, createTempPath } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'json-stream-atomic-replace');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'data.json');
await fsPromises.writeFile(finalPath, 'old');
const tempPath = createTempPath(finalPath);
await fsPromises.writeFile(tempPath, 'new');

await replaceFile(tempPath, finalPath, { keepBackup: false });

const content = await fsPromises.readFile(finalPath, 'utf8');
assert.equal(content, 'new');
assert.equal(fs.existsSync(`${finalPath}.bak`), false, 'expected no backup after replace');

console.log('json-stream atomic replace test passed');
