#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

const tempRoot = await makeTempDir('poc-tooling-cache-build-root-');
const cacheDir = path.join(tempRoot, 'tooling-cache');

const target = {
  chunkRef: {
    chunkUid: 'chunk-build-root',
    chunkId: 'chunk-build-root-id',
    file: 'src/sample.js',
    start: 0,
    end: 10
  },
  virtualPath: 'src/sample.js',
  virtualRange: { start: 0, end: 10 }
};

const makeCtx = (buildRoot) => ({
  strict: true,
  repoRoot: tempRoot,
  buildRoot,
  mode: 'code',
  toolingConfig: {},
  cache: {
    enabled: true,
    dir: cacheDir,
    maxEntries: 100,
    maxBytes: 4 * 1024 * 1024
  }
});

const documents = [{
  virtualPath: 'src/sample.js',
  docHash: 'doc-hash-build-root',
  languageId: 'javascript',
  text: 'function a() {}'
}];

let runCount = 0;
TOOLING_PROVIDERS.clear();
registerToolingProvider({
  id: 'stub',
  version: '1.0.0',
  kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'cfg-v1',
  async run() {
    runCount += 1;
    return {
      byChunkUid: {
        'chunk-build-root': {
          payload: { returnType: `T_${runCount}` }
        }
      }
    };
  }
});

try {
  const buildRootA = path.join(tempRoot, 'builds', 'run-a', 'index-code');
  const buildRootB = path.join(tempRoot, 'builds', 'run-b', 'index-code');

  await runToolingProviders(makeCtx(buildRootA), {
    documents,
    targets: [target],
    kinds: ['types']
  });
  await runToolingProviders(makeCtx(buildRootB), {
    documents,
    targets: [target],
    kinds: ['types']
  });

  assert.equal(runCount, 2, 'expected cache key to vary across build roots');

  console.log('tooling provider cache build-root key test passed');
} finally {
  TOOLING_PROVIDERS.clear();
  await rmDirRecursive(tempRoot);
}
