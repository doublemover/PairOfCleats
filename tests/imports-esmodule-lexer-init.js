#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'imports-esmodule-lexer-init');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'flow-module.js');
const text = "import type { Foo } from 'esm-dep';\nconst value = 1;\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { allImports } = await scanImports({
  files: [{ abs: filePath, rel: 'src/flow-module.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

assert.ok(allImports['esm-dep'], 'expected esm-dep import via fast path');
assert.deepEqual(allImports['esm-dep'], ['src/flow-module.js']);

console.log('imports esmodule lexer init test passed');
