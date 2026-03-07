#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', 'provider-cache-target-symbol-sensitivity');
const cacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });

const chunkUid = 'chunk-symbol-sensitive';
const makeTarget = (symbolName) => ({
  chunkRef: {
    chunkUid,
    chunkId: 'chunk-symbol-sensitive-id',
    file: 'src/sample.js',
    start: 0,
    end: 32
  },
  virtualPath: 'src/sample.js',
  virtualRange: { start: 0, end: 32 },
  symbolHint: {
    name: symbolName,
    kind: 'function'
  }
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
  text: 'function alpha() { return 1; }\n'
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
    const firstTarget = Array.isArray(inputs?.targets) ? inputs.targets[0] : null;
    const symbolName = String(firstTarget?.symbolHint?.name || 'unknown');
    return {
      byChunkUid: {
        [chunkUid]: {
          payload: {
            returnType: `T_${symbolName}`
          }
        }
      }
    };
  }
});

try {
  const first = await runToolingProviders(baseCtx, {
    documents,
    targets: [makeTarget('alpha')],
    kinds: ['types']
  });
  assert.equal(
    first.byChunkUid.get(chunkUid)?.payload?.returnType,
    'T_alpha',
    'expected first symbol payload'
  );

  const second = await runToolingProviders(baseCtx, {
    documents,
    targets: [makeTarget('beta')],
    kinds: ['types']
  });

  assert.equal(runCount, 2, 'expected symbol-sensitive cache key to force rerun');
  assert.equal(
    second.byChunkUid.get(chunkUid)?.payload?.returnType,
    'T_beta',
    'expected second symbol payload without stale cache reuse'
  );

  console.log('tooling provider cache target symbol sensitivity test passed');
} finally {
  TOOLING_PROVIDERS.clear();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
