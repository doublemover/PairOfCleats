#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRetrievalMetadata } from '../../../src/retrieval/output/retrieval-metadata.js';

const metadata = buildRetrievalMetadata({
  backendLabel: 'memory',
  backendPolicyInfo: {
    requested: 'auto',
    defaultBackend: 'sqlite',
    reason: 'sqlite unavailable; using memory',
    backendDisabled: false,
    backendForcedSqlite: false,
    backendForcedLmdb: false,
    backendForcedMemory: false,
    backendForcedTantivy: false
  },
  cacheInfo: {
    hit: true,
    strategy: 'disk-first',
    memoryHotPath: false
  },
  idxCode: {
    state: {
      buildId: 'state-code-build',
      artifactSurfaceVersion: 'surface-state',
      profile: { id: 'default' }
    }
  },
  idxProse: {
    state: {
      buildId: 'state-prose-build',
      artifactSurfaceVersion: 'surface-prose',
      profile: { id: 'vector-only' }
    }
  },
  indexSignaturePayload: {
    modes: {
      code: 'code-signature',
      prose: 'prose-signature'
    },
    generationByMode: {
      code: {
        buildId: 'payload-code-build',
        artifactSurfaceVersion: 'surface-code'
      }
    }
  },
  asOfContext: {
    ref: 'HEAD~1',
    type: 'commit',
    identityHash: 'abc123'
  }
});

assert.equal(metadata.backend.selected, 'memory');
assert.equal(metadata.backend.requested, 'auto');
assert.equal(metadata.backend.defaultBackend, 'sqlite');
assert.equal(metadata.backend.selectionKind, 'policy');
assert.equal(metadata.backend.selectionReason, 'sqlite unavailable; using memory');
assert.equal(metadata.backend.availabilityDriven, true);
assert.equal(metadata.fidelity.status, 'fallback-derived');
assert.equal(metadata.fidelity.fallbackDerived, true);
assert.equal(metadata.cache.hit, true);
assert.equal(metadata.cache.strategy, 'disk-first');
assert.equal(metadata.freshness.byMode.code.buildId, 'payload-code-build');
assert.equal(metadata.freshness.byMode.code.artifactSurfaceVersion, 'surface-code');
assert.equal(metadata.freshness.byMode.code.profileId, 'default');
assert.equal(metadata.freshness.byMode.code.signature, 'code-signature');
assert.equal(metadata.freshness.byMode.prose.buildId, 'state-prose-build');
assert.equal(metadata.freshness.byMode.prose.signature, 'prose-signature');
assert.equal(metadata.freshness.asOf.ref, 'HEAD~1');
assert.equal(metadata.freshness.asOf.identityHash, 'abc123');

console.log('retrieval metadata contract ok');
