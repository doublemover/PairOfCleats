#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

const tempRoot = await makeTempDir('poc-tooling-cache-targets-');
const cacheDir = path.join(tempRoot, 'tooling-cache');

const makeTarget = (chunkUid, chunkId) => ({
  chunkRef: {
    chunkUid,
    chunkId,
    file: 'src/sample.js',
    start: 0,
    end: 10
  },
  virtualPath: 'src/sample.js',
  virtualRange: { start: 0, end: 10 }
});

const baseCtx = {
  strict: true,
  toolingConfig: {},
  cache: {
    enabled: true,
    dir: cacheDir,
    maxEntries: 100,
    maxBytes: 4 * 1024 * 1024
  }
};

const documents = [{
  virtualPath: 'src/sample.js',
  docHash: 'doc-hash-1',
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
  async run(_ctx, inputs) {
    runCount += 1;
    const byChunkUid = Object.create(null);
    for (const target of inputs.targets || []) {
      const chunkUid = target?.chunkRef?.chunkUid;
      if (!chunkUid) continue;
      byChunkUid[chunkUid] = {
        payload: {
          returnType: `T_${chunkUid}`
        }
      };
    }
    return { byChunkUid };
  }
});

try {
  const first = await runToolingProviders(baseCtx, {
    documents,
    targets: [makeTarget('chunk-a', 'chunk-a-id')],
    kinds: ['types']
  });
  assert.ok(first.byChunkUid.has('chunk-a'), 'expected first run to include chunk-a');

  const second = await runToolingProviders(baseCtx, {
    documents,
    targets: [makeTarget('chunk-b', 'chunk-b-id')],
    kinds: ['types']
  });

  assert.equal(runCount, 2, 'expected provider to re-run for different target sets');
  assert.ok(second.byChunkUid.has('chunk-b'), 'expected second run to include chunk-b');
  assert.ok(!second.byChunkUid.has('chunk-a'), 'expected cached output for chunk-a not to leak into chunk-b run');

  console.log('tooling provider cache targets key test passed');
} finally {
  TOOLING_PROVIDERS.clear();
  await rmDirRecursive(tempRoot);
}
