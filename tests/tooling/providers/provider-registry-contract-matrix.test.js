#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { awaitToolingProviderPreflight } from '../../../src/index/tooling/preflight-manager.js';
import {
  TOOLING_PROVIDERS,
  registerToolingProvider,
  selectToolingProviders
} from '../../../src/index/tooling/provider-registry.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildInputs = (chunkUid = 'ck64:v1:test:src/sample.js:deadbeef') => ({
  documents: [{
    virtualPath: 'src/sample.js',
    languageId: 'javascript',
    effectiveExt: '.js',
    docHash: 'doc-hash-1',
    text: 'function demo() {}'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_deadbeef',
      file: 'src/sample.js',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: 10 }
    },
    name: 'greet',
    virtualPath: 'src/sample.js',
    virtualRange: { start: 0, end: 10 }
  }]
});

const resetProviders = () => TOOLING_PROVIDERS.clear();

const runSelectionCases = () => {
  resetProviders();
  const makeProvider = (id, priority, extra = {}) => registerToolingProvider({
    id,
    version: '1.0.0',
    priority,
    capabilities: { supportsVirtualDocuments: true },
    getConfigHash: () => id,
    async run() {
      return { byChunkUid: {} };
    },
    ...extra
  });

  makeProvider('beta', 10);
  makeProvider('alpha', 5);
  makeProvider('gamma', 5);
  makeProvider('typed', 7, { kinds: ['types'] });
  makeProvider('untyped', 8);

  const inputs = buildInputs('ck64:v1:test:src/sample.js:demo');

  const defaultPlans = selectToolingProviders({ toolingConfig: {}, ...inputs });
  assert.deepEqual(defaultPlans.map((plan) => plan.provider.id), ['alpha', 'gamma', 'typed', 'untyped', 'beta']);

  const overridePlans = selectToolingProviders({
    toolingConfig: { providerOrder: ['beta', 'alpha'] },
    ...inputs
  });
  assert.deepEqual(overridePlans.slice(0, 2).map((plan) => plan.provider.id), ['beta', 'alpha']);

  const gatedPlans = selectToolingProviders({
    toolingConfig: { enabledTools: ['beta'], disabledTools: ['alpha'] },
    ...inputs
  });
  assert.equal(gatedPlans.length, 1);
  assert.equal(gatedPlans[0].provider.id, 'beta');

  const kindFilteredPlans = selectToolingProviders({
    toolingConfig: { enabledTools: ['typed', 'untyped'] },
    kinds: ['types'],
    ...inputs
  });
  assert.deepEqual(kindFilteredPlans.map((plan) => plan.provider.id), ['typed', 'untyped']);
};

const runMergeAndLegacyCases = async () => {
  resetProviders();
  const chunkUid = 'ck64:v1:test:src/sample.js:deadbeef';
  registerToolingProvider({
    id: 'alpha',
    version: '1.0.0',
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'hash-alpha',
    async run() {
      return {
        byChunkUid: {
          [chunkUid]: {
            payload: { returnType: 'number' }
          }
        }
      };
    }
  });
  registerToolingProvider({
    id: 'beta',
    version: '1.0.0',
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'hash-beta',
    async run() {
      return {
        byChunkUid: {
          [chunkUid]: {
            payload: {
              returnType: 'string',
              paramTypes: {
                x: [{ type: 'number', confidence: 0.8, source: 'tooling' }]
              }
            }
          }
        }
      };
    }
  });
  registerToolingProvider({
    id: 'legacy-stub',
    version: '1.0.0',
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'hash-legacy',
    async run() {
      return {
        byLegacyKey: {
          'src/sample.js::greet': { payload: { returnType: 'ignored' } }
        }
      };
    }
  });

  const result = await runToolingProviders({
    strict: true,
    toolingConfig: {},
    cache: { enabled: false }
  }, buildInputs(chunkUid), ['alpha', 'beta', 'legacy-stub']);

  const merged = result.byChunkUid.get(chunkUid);
  assert.ok(merged, 'expected merged tooling entry');
  assert.equal(merged.payload.returnType, 'number');
  assert.ok(Array.isArray(merged.payload.paramTypes?.x));
  assert.equal(result.byChunkUid.has('src/sample.js::greet'), false);
};

const runStrictMissingChunkUidCase = async () => {
  resetProviders();
  registerToolingProvider({
    id: 'stub',
    version: '1.0.0',
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
    getConfigHash: () => 'hash',
    async run() {
      return { byChunkUid: {} };
    }
  });

  await assert.rejects(
    () => runToolingProviders({
      strict: true,
      toolingConfig: {},
      cache: { enabled: false }
    }, {
      documents: [],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid: null,
          chunkId: 'chunk_deadbeef',
          file: 'src/sample.js',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: 10 }
        },
        name: 'greet',
        virtualPath: 'src/sample.js',
        virtualRange: { start: 0, end: 10 }
      }]
    }),
    /./,
    'expected strict mode to reject missing chunkUid'
  );
};

const runPreflightOverlapCase = async () => {
  resetProviders();
  const registerFixtureProvider = (id, priority) => {
    const provider = {
      id,
      version: '1.0.0',
      priority,
      preflightId: `${id}.workspace-model`,
      preflightClass: 'workspace',
      capabilities: {
        supportsVirtualDocuments: true,
        supportsSegmentRouting: true
      },
      getConfigHash() {
        return `${id}-hash`;
      },
      async preflight() {
        await wait(60);
        return { state: 'ready' };
      },
      async run(ctx, inputs) {
        await awaitToolingProviderPreflight(ctx, {
          provider,
          inputs,
          waveToken: typeof inputs?.toolingPreflightWaveToken === 'string'
            ? inputs.toolingPreflightWaveToken
            : null
        });
        return { byChunkUid: {} };
      }
    };
    registerToolingProvider(provider);
  };

  registerFixtureProvider('preflight-alpha', 5);
  registerFixtureProvider('preflight-beta', 10);

  const logs = [];
  const result = await runToolingProviders({
    strict: true,
    toolingConfig: {},
    cache: { enabled: false },
    logger: (line) => logs.push(String(line || ''))
  }, {
    documents: [{
      virtualPath: 'src/sample.fixture',
      languageId: 'fixture',
      docHash: 'doc-hash-1'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'chunk-1',
        chunkId: 'chunk-1',
        file: 'src/sample.fixture',
        range: { start: 0, end: 1 }
      },
      virtualPath: 'src/sample.fixture',
      virtualRange: { start: 0, end: 1 }
    }]
  });

  assert.equal(Number(result.metrics?.preflights?.total || 0), 2);
  const alphaStartIndex = logs.findIndex((line) => line.includes('preflight:start provider=preflight-alpha'));
  const betaStartIndex = logs.findIndex((line) => line.includes('preflight:start provider=preflight-beta'));
  const alphaDoneIndex = logs.findIndex((line) => line.includes('provider 1/2 done id=preflight-alpha'));
  assert.notEqual(alphaStartIndex, -1);
  assert.notEqual(betaStartIndex, -1);
  assert.notEqual(alphaDoneIndex, -1);
  assert.equal(betaStartIndex < alphaDoneIndex, true);
};

await runSelectionCases();
await runMergeAndLegacyCases();
await runStrictMissingChunkUidCase();
await runPreflightOverlapCase();
console.log('tooling provider registry contract matrix test passed');
