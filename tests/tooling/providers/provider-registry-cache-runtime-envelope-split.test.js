#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', 'provider-cache-runtime-envelope-split');
const cacheDir = path.join(tempRoot, 'tooling-cache');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(cacheDir, { recursive: true });

const chunkUid = 'chunk-runtime-split';
const target = {
  chunkRef: {
    chunkUid,
    chunkId: 'chunk-runtime-split-id',
    file: 'src/sample.js',
    start: 0,
    end: 24
  },
  virtualPath: 'src/sample.js',
  virtualRange: { start: 0, end: 24 },
  symbolHint: {
    name: 'alpha',
    kind: 'function'
  }
};

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
  docHash: 'doc-hash-runtime-split',
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
  async run() {
    runCount += 1;
    return {
      byChunkUid: {
        [chunkUid]: {
          payload: { returnType: 'number' }
        }
      },
      diagnostics: {
        checks: [{
          name: 'stub_deterministic_check',
          status: 'info',
          message: 'deterministic-check'
        }],
        runtime: {
          command: `stub-runtime-${runCount}`,
          requests: { requests: runCount }
        }
      }
    };
  }
});

try {
  const first = await runToolingProviders(baseCtx, {
    documents,
    targets: [target],
    kinds: ['types']
  });
  assert.equal(runCount, 1, 'expected first run to execute provider');
  assert.equal(
    first.diagnostics?.stub?.runtime?.command,
    'stub-runtime-1',
    'expected live runtime envelope on first run'
  );
  assert.equal(
    first.diagnostics?.stub?.diagnosticsSource,
    'live',
    'expected live diagnostics source marker on first run'
  );

  const second = await runToolingProviders(baseCtx, {
    documents,
    targets: [target],
    kinds: ['types']
  });
  assert.equal(runCount, 1, 'expected second run to use cache');
  assert.equal(
    second.diagnostics?.stub?.runtime == null,
    true,
    'expected cached diagnostics to exclude stale runtime envelope'
  );
  assert.equal(
    second.diagnostics?.stub?.checks?.[0]?.name,
    'stub_deterministic_check',
    'expected deterministic checks to remain available on cache hits'
  );
  assert.equal(
    second.diagnostics?.stub?.diagnosticsSource,
    'cache-suppressed',
    'expected cache-hit diagnostics source marker'
  );

  console.log('tooling provider cache runtime envelope split test passed');
} finally {
  TOOLING_PROVIDERS.clear();
  await fs.rm(tempRoot, { recursive: true, force: true });
}
