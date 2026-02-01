#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'imports-regex-fallback');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'broken.js');
const text = "const lib = require('regex-dep');\nconst = ;\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { importsByFile } = await scanImports({
  files: [{ abs: filePath, rel: 'src/broken.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

const imports = importsByFile['src/broken.js'] || [];
assert.ok(imports.includes('regex-dep'), 'expected regex-dep import from regex fallback');

console.log('imports require regex fallback test passed');

