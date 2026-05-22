#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutputForTest } from '../helpers/search-output-fixture.js';

const profileInfo = {
  byMode: {
    code: {
      profileId: 'vector_only',
      vectorOnly: true,
      allowSparseFallback: true,
      sparseUnavailableReason: 'profile_vector_only'
    }
  },
  warnings: [
    'Sparse-only request overridden for vector_only mode(s): code. ANN fallback was used.'
  ]
};

const payload = renderSearchOutputForTest({
  routingPolicy: { byMode: { code: { desired: 'sparse', reason: 'test' } } },
  queryTokens: ['alpha'],
  annEnabled: true,
  annActive: true,
  annBackend: 'js',
  profileInfo,
  intentInfo: { type: 'keyword' }
});

assert.equal(payload?.stats?.profile?.byMode?.code?.profileId, 'vector_only');
assert.equal(payload?.stats?.profile?.byMode?.code?.sparseUnavailableReason, 'profile_vector_only');
assert.ok(
  payload?.stats?.profile?.warnings?.some((entry) => String(entry).includes('ANN fallback')),
  'expected profile warnings to include override guidance'
);

console.log('explain vector-only warnings test passed');
