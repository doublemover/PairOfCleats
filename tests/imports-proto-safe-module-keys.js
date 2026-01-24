#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'imports-proto-safe');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'proto.js');
const text = "import protoDep from '__proto__';\nexport default protoDep;\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { allImports } = await scanImports({
  files: [{ abs: filePath, rel: 'src/proto.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

assert.equal(Object.getPrototypeOf(allImports), null, 'allImports should have null prototype');
assert.ok(Array.isArray(allImports['__proto__']), 'expected __proto__ import key');
assert.deepEqual(allImports['__proto__'], ['src/proto.js']);
assert.ok(!Object.prototype.polluted, 'Object.prototype should remain clean');

console.log('imports proto-safe module keys test passed');
