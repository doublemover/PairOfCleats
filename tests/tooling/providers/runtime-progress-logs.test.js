#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import {
  createToolingProviderLogCollector,
  runToolingProviderFixture
} from './provider-run-fixture.js';

TOOLING_PROVIDERS.clear();

registerToolingProvider({
  id: 'progress-fixture',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => 'hash-progress-fixture',
  async run() {
    return {
      byChunkUid: {}
    };
  }
});

const { logs, logger } = createToolingProviderLogCollector();
await runToolingProviderFixture({ logger });

assert.ok(
  logs.some((line) => line.includes('[tooling] provider runtime start providers=1')),
  'expected provider runtime start progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider 1/1 start id=progress-fixture')),
  'expected provider start progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider 1/1 done id=progress-fixture')),
  'expected provider done progress log'
);
assert.ok(
  logs.some((line) => line.includes('[tooling] provider runtime done providers=1')),
  'expected provider runtime done progress log'
);

console.log('tooling provider runtime progress logs test passed');
