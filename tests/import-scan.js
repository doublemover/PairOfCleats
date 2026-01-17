#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'import-scan');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'dynamic.js');
const text = "export async function load() { return import('dyn-lib'); }\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { allImports } = await scanImports({
  files: [{ abs: filePath, rel: 'src/dynamic.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

assert.ok(allImports['dyn-lib'], 'expected dyn-lib to be recorded as an import');
assert.deepEqual(allImports['dyn-lib'], ['src/dynamic.js']);
assert.ok(!Object.keys(allImports).some((key) => key === '0' || key === '1'), 'unexpected numeric import keys');

console.log('import scan test passed');
