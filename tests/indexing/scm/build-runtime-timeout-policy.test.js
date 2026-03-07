#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../src/index/build/runtime.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'build-runtime-scm-timeout-policy');
const repoRoot = path.join(tempRoot, 'repo');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');

applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'off',
  testConfig: {
    indexing: {
      scm: {
        provider: 'none'
      },
      embeddings: {
        enabled: false,
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      },
      treeSitter: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false
    }
  }
});

const defaults = parseBuildArgs([]).argv;
const runtime = await createBuildRuntime({
  root: repoRoot,
  argv: defaults,
  rawArgv: []
});

assert.equal(runtime?.scmConfig?.workload, 'batch', 'expected build runtime to mark SCM workload as batch');
assert.equal(
  runtime?.scmConfig?.allowSlowTimeouts,
  true,
  'expected build runtime SCM policy to allow slower timeout defaults'
);
assert.equal(
  runtime?.scmConfig?.annotate?.allowSlowTimeouts,
  true,
  'expected build runtime SCM annotate policy to allow slower timeout defaults'
);

console.log('build runtime SCM timeout policy test passed');
