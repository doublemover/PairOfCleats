#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateQueryPlan } from '../../../src/retrieval/query-plan-schema.js';
import { buildTestPlan, createPlanInputs } from './query-plan-helpers.js';

applyTestEnv();

const inputs = createPlanInputs({ query: 'alpha "beta gamma"' });
const plan = buildTestPlan(inputs);

assert.ok(validateQueryPlan(plan), 'expected query plan to pass schema validation');
assert.ok(Array.isArray(plan.queryTokens), 'expected query tokens array');
assert.ok(plan.highlightRegex instanceof RegExp, 'expected highlight regex');
assert.ok(plan.phraseNgramSet instanceof Set || plan.phraseNgramSet === null, 'expected phrase ngram set');
assert.ok(plan.requiredArtifacts instanceof Set, 'expected requiredArtifacts set');

console.log('query plan requirements test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
