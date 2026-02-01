#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { writeJsonWithDir } from '../../../tools/bench/micro/utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'bench-micro-baseline');
await fsPromises.rm(tempRoot, { recursive: true, force: true });

const targetPath = path.join(tempRoot, 'nested', 'baseline.json');
writeJsonWithDir(targetPath, { ok: true });

const payload = JSON.parse(await fsPromises.readFile(targetPath, 'utf8'));
assert.equal(payload.ok, true);

console.log('bench micro baseline write test passed');

