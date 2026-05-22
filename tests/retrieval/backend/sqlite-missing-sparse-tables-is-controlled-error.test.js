#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createAlphaSearchIndex,
  createSearchPipelineFixture
} from '../helpers/search-pipeline-fixture.js';

const pipeline = createSearchPipelineFixture({
  useSqlite: true,
  sqliteFtsRequested: false,
  sqliteFtsRoutingByMode: {
    byMode: {
      code: {
        mode: 'code',
        desired: 'sparse',
        active: false,
        reason: 'default_code_sparse'
      }
    }
  },
  sqliteFtsVariantConfig: {
    explicitTrigram: false,
    substringMode: false,
    stemming: false
  },
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true },
  profilePolicyByMode: {
    code: {
      profileId: 'default',
      vectorOnly: false,
      allowSparseFallback: false
    }
  },
  sqliteHasFts: () => false,
  sqliteHasTable: (_mode, _table) => false
});

const idx = createAlphaSearchIndex({ tokenIndex: null });

let failed = false;
try {
  await pipeline(idx, 'code', null);
} catch (err) {
  failed = true;
  assert.equal(err?.code, 'CAPABILITY_MISSING', 'expected controlled capability error');
  assert.equal(err?.reasonCode, 'retrieval_sparse_unavailable', 'expected sparse unavailable reason code');
  assert.match(String(err?.message || err), /Sparse retrieval backend is unavailable/i);
}

if (!failed) {
  throw new Error('Expected missing sparse tables to produce a controlled error');
}

console.log('sqlite missing sparse tables controlled error test passed');
