#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { getRuntimeConfig, loadUserConfig, resolveRepoRootArg, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';

const root = resolveToolRoot();
const repoRoot = resolveRepoRootArg(null, root);
const userConfig = loadUserConfig(repoRoot);
const runtimeEnv = resolveRuntimeEnv(getRuntimeConfig(repoRoot, userConfig), process.env);
if (!runtimeEnv.PAIROFCLEATS_TESTING) {
  runtimeEnv.PAIROFCLEATS_TESTING = '1';
}
const tests = [
  {
    label: 'type-inference-lsp-enrichment',
    file: path.join(root, 'tests', 'indexing', 'type-inference', 'providers', 'type-inference-lsp-enrichment.test.js')
  },
  {
    label: 'embeddings-dims-mismatch',
    file: path.join(root, 'tests', 'indexing', 'embeddings', 'dims-mismatch.test.js')
  },
  {
    label: 'embeddings-cache-identity',
    file: path.join(root, 'tests', 'indexing', 'embeddings', 'cache-identity.test.js')
  }
];

for (const test of tests) {
  if (!fs.existsSync(test.file)) {
    console.error(`lsp/embeddings gate misconfigured: missing test file for ${test.label}: ${test.file}`);
    process.exit(1);
  }
}

for (const test of tests) {
  const result = spawnSubprocessSync(process.execPath, [test.file], {
    stdio: 'inherit',
    rejectOnNonZeroExit: false,
    cwd: repoRoot,
    env: runtimeEnv
  });
  if (result.exitCode !== 0) {
    console.error(`lsp/embeddings gate failed: ${test.label}`);
    exitLikeCommandResult({ status: result.exitCode, signal: result.signal });
  }
}

console.error('lsp/embeddings gate tests passed');
