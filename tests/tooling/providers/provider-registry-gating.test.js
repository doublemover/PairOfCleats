#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider, selectToolingProviders } from '../../../src/index/tooling/provider-registry.js';

TOOLING_PROVIDERS.clear();

const makeProvider = (id) => registerToolingProvider({
  id,
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true },
  getConfigHash: () => id,
  async run() {
    return { byChunkUid: {} };
  }
});

makeProvider('alpha');
makeProvider('beta');

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

const plans = selectToolingProviders({
  toolingConfig: { enabledTools: ['beta'], disabledTools: ['alpha'] },
  documents,
  targets
});

assert.equal(plans.length, 1, 'expected one provider plan');
assert.equal(plans[0].provider.id, 'beta');

registerToolingProvider({
  id: 'typed',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true },
  kinds: ['types'],
  getConfigHash: () => 'typed',
  async run() {
    return { byChunkUid: {} };
  }
});
registerToolingProvider({
  id: 'untyped',
  version: '1.0.0',
  capabilities: { supportsVirtualDocuments: true },
  getConfigHash: () => 'untyped',
  async run() {
    return { byChunkUid: {} };
  }
});

const kindFilteredPlans = selectToolingProviders({
  toolingConfig: { enabledTools: ['typed', 'untyped'] },
  documents,
  targets,
  kinds: ['types']
});
assert.equal(kindFilteredPlans.length, 1, 'expected kind filter to exclude providers with empty kinds');
assert.equal(kindFilteredPlans[0].provider.id, 'typed');

console.log('tooling provider registry gating test passed');
