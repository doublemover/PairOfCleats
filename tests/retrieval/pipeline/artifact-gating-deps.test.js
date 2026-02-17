#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import {
  REQUIRED_ARTIFACTS,
  resolveRequiredArtifacts
} from '../../../src/retrieval/cli/required-artifacts.js';
import { buildTestPlan, createPlanInputs } from './query-plan-helpers.js';

applyTestEnv();

const inputs = createPlanInputs();
const plan = buildTestPlan(inputs);
const required = resolveRequiredArtifacts({
  queryPlan: plan,
  contextExpansionEnabled: true,
  contextExpansionOptions: {
    includeCalls: false,
    includeImports: false,
    includeUsages: false,
    includeExports: true
  },
  contextExpansionRespectFilters: true,
  graphRankingEnabled: false,
  annActive: false
});

assert.ok(required.has(REQUIRED_ARTIFACTS.REPO_MAP), 'expected repoMap requirement');
assert.ok(required.has(REQUIRED_ARTIFACTS.GRAPH_RELATIONS), 'expected graphRelations dependency');

console.log('artifact gating dependencies test passed');
