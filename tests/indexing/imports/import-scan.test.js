#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const filePath = path.join(srcRoot, 'dynamic.js');
const text = "export async function load() { return import('dyn-lib'); }\n";
await fs.writeFile(filePath, text);
const stat = await fs.stat(filePath);

const { importsByFile } = await scanImports({
  files: [{ abs: filePath, rel: 'src/dynamic.js', stat }],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

const imports = importsByFile['src/dynamic.js'] || [];
assert.ok(imports.includes('dyn-lib'), 'expected dyn-lib to be recorded as an import');
assert.ok(!Object.keys(importsByFile).some((key) => key === '0' || key === '1'), 'unexpected numeric import keys');

console.log('import scan test passed');

