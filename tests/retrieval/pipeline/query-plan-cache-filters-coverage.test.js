#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const plan = buildQueryPlan({
  query: 'alpha',
  argv: {
    lint: false
  },
  dict: new Set(['alpha']),
  dictConfig: { caseSensitive: false },
  postingsConfig: {
    enablePhraseNgrams: true,
    phraseMinN: 2,
    phraseMaxN: 3,
    chargramMinN: 3
  },
  caseTokens: false,
  fileFilter: 'src/',
  caseFile: false,
  searchRegexConfig: null,
  filePrefilterEnabled: false,
  fileChargramN: 5,
  searchType: null,
  searchAuthor: null,
  searchImport: null,
  chunkAuthorFilter: null,
  branchesMin: null,
  loopsMin: null,
  breaksMin: null,
  continuesMin: null,
  churnMin: null,
  extFilter: '.js',
  langFilter: 'javascript',
  extImpossible: new Set(['.md', '.txt']),
  langImpossible: { markdown: true, yaml: true, css: false },
  metaFilters: null,
  modifiedAfter: null,
  modifiedSinceDays: null,
  fieldWeightsConfig: null,
  denseVectorMode: 'merged',
  branchFilter: null
});

assert.deepEqual(
  plan.cacheFilters.filePrefilter,
  { enabled: false, chargramN: 5 },
  'expected file prefilter settings to be included in query cache filters'
);
assert.deepEqual(
  plan.cacheFilters.extImpossible,
  ['.md', '.txt'],
  'expected extImpossible values to be normalized into cache filter payload'
);
assert.deepEqual(
  plan.cacheFilters.langImpossible,
  ['markdown', 'yaml'],
  'expected langImpossible values to be normalized into cache filter payload'
);

console.log('query plan cache filters coverage test passed');
