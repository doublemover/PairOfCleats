#!/usr/bin/env node
import path from 'node:path';
import { spawnSubprocessSync } from '../src/shared/subprocess.js';
import { getRuntimeConfig, loadUserConfig, resolveRepoRoot, resolveRuntimeEnv } from './dict-utils.js';

const root = process.cwd();
const repoRoot = resolveRepoRoot(root);
const userConfig = loadUserConfig(repoRoot);
const runtimeEnv = resolveRuntimeEnv(getRuntimeConfig(repoRoot, userConfig), process.env);
const tests = [
  { label: 'type-inference-lsp-enrichment', file: path.join(root, 'tests', 'type-inference-lsp-enrichment.js') },
  { label: 'embeddings-dims-mismatch', file: path.join(root, 'tests', 'embeddings-dims-mismatch.js') },
  { label: 'embeddings-cache-identity', file: path.join(root, 'tests', 'embeddings-cache-identity.js') }
];

for (const test of tests) {
  const result = spawnSubprocessSync(process.execPath, [test.file], {
    stdio: 'inherit',
    rejectOnNonZeroExit: false,
    env: runtimeEnv
  });
  if (result.exitCode !== 0) {
    console.error(`phase22 gate failed: ${test.label}`);
    process.exit(result.exitCode ?? 1);
  }
}

console.error('phase22 gate tests passed');
