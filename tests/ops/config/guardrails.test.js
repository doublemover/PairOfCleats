#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import {
  OP_CONFIG_GUARDRAIL_CODES,
  OP_RETRIEVAL_DEFAULTS,
  normalizeSearchOptions
} from '../../../src/retrieval/cli/normalize-options.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { resolveOperationalGuardrails } from '../../../src/retrieval/operational-guardrails.js';

const rootDir = process.cwd();
const metricsDir = resolveTestCachePath(rootDir, 'ops-config-guardrails');

const normalizeWithConfig = ({ args, userConfig, policy } = {}) => normalizeSearchOptions({
  argv: parseSearchArgs(args || ['hello']),
  rawArgs: args || ['hello'],
  rootDir,
  userConfig: userConfig || {},
  metricsDir,
  policy: policy || {}
});

const defaults = normalizeWithConfig({
  args: ['--mode', 'code', 'hello'],
  userConfig: {}
});
assert.equal(
  defaults.annCandidateCap,
  OP_RETRIEVAL_DEFAULTS.annCandidateCap,
  'expected conservative annCandidateCap default when knobs are absent'
);
assert.equal(
  defaults.annCandidateMinDocCount,
  OP_RETRIEVAL_DEFAULTS.annCandidateMinDocCount,
  'expected conservative annCandidateMinDocCount default when knobs are absent'
);
assert.equal(
  defaults.annCandidateMaxDocCount,
  OP_RETRIEVAL_DEFAULTS.annCandidateMaxDocCount,
  'expected conservative annCandidateMaxDocCount default when knobs are absent'
);
assert.equal(
  defaults.queryCacheMaxEntries,
  OP_RETRIEVAL_DEFAULTS.queryCacheMaxEntries,
  'expected query-cache max entries default to remain unchanged'
);
assert.equal(
  defaults.queryCacheTtlMs,
  OP_RETRIEVAL_DEFAULTS.queryCacheTtlMs,
  'expected query-cache ttl default to remain unchanged'
);

assert.throws(() => normalizeWithConfig({
  args: ['hello'],
  userConfig: {
    retrieval: {
      annCandidateMinDocCount: 200,
      annCandidateMaxDocCount: 100
    }
  }
}), (error) => String(error?.message || '').includes(OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_BOUNDS_INVALID));

assert.throws(() => normalizeWithConfig({
  args: ['hello'],
  userConfig: {
    retrieval: {
      annCandidateCap: 500,
      annCandidateMinDocCount: 1,
      annCandidateMaxDocCount: 100
    }
  }
}), (error) => String(error?.message || '').includes(OP_CONFIG_GUARDRAIL_CODES.ANN_CANDIDATE_CAP_OUT_OF_RANGE));

assert.throws(() => normalizeWithConfig({
  args: ['hello'],
  userConfig: {
    search: {
      rrf: {
        k: 0
      }
    }
  }
}), (error) => String(error?.message || '').includes(OP_CONFIG_GUARDRAIL_CODES.RRF_K_INVALID));

const boundaryValid = normalizeWithConfig({
  args: ['hello'],
  userConfig: {
    retrieval: {
      annCandidateCap: 100,
      annCandidateMinDocCount: 100,
      annCandidateMaxDocCount: 100
    },
    search: {
      rrf: {
        k: 1
      }
    }
  }
});
assert.equal(boundaryValid.annCandidateCap, 100, 'expected equal min/max/cap boundary to remain valid');
assert.equal(boundaryValid.annCandidateMinDocCount, 100, 'expected min boundary to remain valid');
assert.equal(boundaryValid.annCandidateMaxDocCount, 100, 'expected max boundary to remain valid');
assert.equal(boundaryValid.rrfK, 1, 'expected positive boundary rrf.k to remain valid');

// The editor's pure owner and the actual search normalizer use identical values
// and reject the same default-dependent combinations; no duplicate constants.
for (const userConfig of [{}, { retrieval: { annCandidateCap: 1000 } },
  { retrieval: { annCandidateCap: 100, annCandidateMinDocCount: 100, annCandidateMaxDocCount: 100 } },
  { search: { rrf: { k: 2 } } }]) {
  const actual = normalizeWithConfig({ userConfig });
  const admitted = resolveOperationalGuardrails({ userConfig });
  for (const key of Object.keys(admitted)) assert.equal(actual[key], admitted[key]);
}
for (const userConfig of [{ retrieval: { annCandidateMaxDocCount: 1000 } },
  { retrieval: { annCandidateMinDocCount: 1000, annCandidateMaxDocCount: 500 } }, { search: { rrf: { k: 0 } } }]) {
  let expected;
  assert.throws(() => resolveOperationalGuardrails({ userConfig }), error => { expected = error.guardrailCode; return true; });
  assert.throws(() => normalizeWithConfig({ userConfig }), error => error.guardrailCode === expected);
}
assert.equal(resolveOperationalGuardrails({ policy: { retrieval: { rrf: { k: 3 } } } }).rrfK, 3);
assert.equal(normalizeWithConfig({ policy: { retrieval: { rrf: { k: 3 } } } }).rrfK, 3);

console.log('ops config guardrails test passed');
