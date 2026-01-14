#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tests = [
  { label: 'type-inference-lsp-enrichment', file: path.join(root, 'tests', 'type-inference-lsp-enrichment.js') },
  { label: 'embeddings-dims-mismatch', file: path.join(root, 'tests', 'embeddings-dims-mismatch.js') },
  { label: 'embeddings-cache-identity', file: path.join(root, 'tests', 'embeddings-cache-identity.js') }
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [test.file], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`phase22 gate failed: ${test.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('phase22 gate tests passed');
