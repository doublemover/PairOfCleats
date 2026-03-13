#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'src/index/tooling/lsp-provider.js',
  'src/index/tooling/dedicated-lsp-provider.js',
  'src/index/tooling/pyright-provider.js',
  'src/index/tooling/clangd-provider.js',
  'src/index/tooling/sourcekit-provider.js'
];

for (const relativePath of files) {
  const abs = path.join(root, relativePath);
  const content = fs.readFileSync(abs, 'utf8');
  assert.equal(
    content.includes('resolveRuntimeCommandFromPreflight('),
    true,
    `expected ${relativePath} to use shared resolveRuntimeCommandFromPreflight helper`
  );
}

console.log('preflight runtime-command helper usage guard test passed');
