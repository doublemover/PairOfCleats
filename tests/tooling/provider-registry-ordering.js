#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider, selectToolingProviders } from '../../src/index/tooling/provider-registry.js';

TOOLING_PROVIDERS.clear();

const makeProvider = (id, priority) => registerToolingProvider({
  id,
  version: '1.0.0',
  priority,
  capabilities: { supportsVirtualDocuments: true },
  getConfigHash: () => id,
  async run() {
    return { byChunkUid: {} };
  }
});

makeProvider('beta', 10);
makeProvider('alpha', 5);
makeProvider('gamma', 5);

const documents = [{
  virtualPath: 'src/sample.js',
  languageId: 'javascript',
  effectiveExt: '.js',
  text: 'function demo() {}'
}];
const targets = [{
  virtualPath: 'src/sample.js',
  languageId: 'javascript',
  virtualRange: { start: 0, end: 1 },
  chunkRef: { chunkUid: 'ck64:v1:test:src/sample.js:demo', chunkId: 'chunk_demo', file: 'src/sample.js' }
}];

const defaultPlans = selectToolingProviders({ toolingConfig: {}, documents, targets });
const defaultIds = defaultPlans.map((plan) => plan.provider.id);
assert.deepEqual(defaultIds, ['alpha', 'gamma', 'beta']);

const overridePlans = selectToolingProviders({
  toolingConfig: { providerOrder: ['beta', 'alpha'] },
  documents,
  targets
});
const overrideIds = overridePlans.map((plan) => plan.provider.id);
assert.deepEqual(overrideIds.slice(0, 2), ['beta', 'alpha']);

console.log('tooling provider registry ordering test passed');
