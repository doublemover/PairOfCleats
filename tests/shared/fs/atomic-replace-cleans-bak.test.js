#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../../../src/shared/json-stream.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'atomic-replace');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'target.json');
const tempPath = path.join(outDir, 'target.tmp');

await fsPromises.writeFile(finalPath, 'before', 'utf8');
await fsPromises.writeFile(tempPath, 'after', 'utf8');

await replaceFile(tempPath, finalPath);

const contents = await fsPromises.readFile(finalPath, 'utf8');
assert.equal(contents, 'after');
assert.ok(!fs.existsSync(`${finalPath}.bak`), 'expected .bak to be removed after replace');

console.log('atomic replace cleans .bak test passed');

