#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'imports-proto-safe');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'proto.js');
const text = "import protoDep from '__proto__';\nexport default protoDep;\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { importsByFile } = await scanImports({
  files: [{ abs: filePath, rel: 'src/proto.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

assert.equal(Object.getPrototypeOf(importsByFile), null, 'importsByFile should have null prototype');
const imports = importsByFile['src/proto.js'] || [];
assert.ok(imports.includes('__proto__'), 'expected __proto__ import entry');
assert.ok(!Object.prototype.polluted, 'Object.prototype should remain clean');

console.log('imports proto-safe module keys test passed');

