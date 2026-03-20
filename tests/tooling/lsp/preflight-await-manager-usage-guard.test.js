#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const REQUIRED_FILES = [
  'src/index/tooling/lsp-provider/factory.js',
  'src/index/tooling/dedicated-lsp-provider.js',
  'src/index/tooling/pyright-provider.js',
  'src/index/tooling/clangd-provider.js',
  'src/index/tooling/sourcekit-provider.js'
];

for (const relativePath of REQUIRED_FILES) {
  const abs = path.join(root, relativePath);
  const content = fs.readFileSync(abs, 'utf8');
  assert.equal(
    content.includes('await awaitToolingProviderPreflight('),
    true,
    `expected ${relativePath} to await preflight via preflight-manager`
  );
}

console.log('preflight await-manager usage guard test passed');
