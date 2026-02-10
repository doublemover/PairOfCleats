#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { candidateNames, findBinaryInDirs, findBinaryOnPath, splitPathEntries } from '../../src/index/tooling/binary-utils.js';

const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'binary-utils-'));
const binDir = path.join(tmpRoot, 'bin');
await fsPromises.mkdir(binDir, { recursive: true });

const names = candidateNames('my-tool');
assert.ok(Array.isArray(names) && names.length >= 1);

const preferred = names[0];
await fsPromises.writeFile(path.join(binDir, preferred), 'echo test\n', 'utf8');

const fromDirs = findBinaryInDirs('my-tool', [binDir]);
assert.equal(fromDirs, path.join(binDir, preferred));

const envPath = [binDir, path.join(tmpRoot, 'other')].join(path.delimiter);
const entries = splitPathEntries(envPath);
assert.deepEqual(entries, [binDir, path.join(tmpRoot, 'other')]);

const fromPath = findBinaryOnPath('my-tool', envPath);
assert.equal(fromPath, path.join(binDir, preferred));

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('binary utils parity test passed');
