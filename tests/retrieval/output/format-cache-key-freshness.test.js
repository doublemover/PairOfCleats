#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFormatCacheKey,
  buildQueryHash
} from '../../../src/retrieval/output/format/display-meta.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const regex = /alpha/gi;
const hashSingleToken = buildQueryHash(['foo|bar'], regex);
const hashSplitTokens = buildQueryHash(['foo', 'bar'], regex);
assert.notEqual(
  hashSingleToken,
  hashSplitTokens,
  'query-token hashing must distinguish literal delimiters from token boundaries'
);

const baselineChunk = {
  file: 'src/a.js',
  start: 0,
  end: 20,
  name: 'alpha',
  kind: 'FunctionDeclaration',
  headline: 'alpha()',
  docmeta: {
    signature: 'alpha()'
  },
  codeRelations: {
    calls: [['alpha', 'beta']]
  }
};

const baselineKey = buildFormatCacheKey({
  chunk: baselineChunk,
  index: 0,
  mode: 'code',
  queryHash: hashSingleToken,
  matched: true,
  explain: false
});
const stableRepeatKey = buildFormatCacheKey({
  chunk: { ...baselineChunk, docmeta: { ...baselineChunk.docmeta } },
  index: 0,
  mode: 'code',
  queryHash: hashSingleToken,
  matched: true,
  explain: false
});
assert.equal(stableRepeatKey, baselineKey, 'format cache key should be deterministic for equivalent chunks');

const headlineUpdatedKey = buildFormatCacheKey({
  chunk: { ...baselineChunk, headline: 'alphaChanged()' },
  index: 0,
  mode: 'code',
  queryHash: hashSingleToken,
  matched: true,
  explain: false
});
assert.notEqual(
  headlineUpdatedKey,
  baselineKey,
  'format cache key should invalidate when format-visible chunk content changes'
);

const docmetaUpdatedKey = buildFormatCacheKey({
  chunk: {
    ...baselineChunk,
    docmeta: {
      ...baselineChunk.docmeta,
      signature: 'alpha(value)'
    }
  },
  index: 0,
  mode: 'code',
  queryHash: hashSingleToken,
  matched: true,
  explain: false
});
assert.notEqual(
  docmetaUpdatedKey,
  baselineKey,
  'format cache key should include docmeta freshness signal'
);

console.log('format cache key freshness tests passed');
