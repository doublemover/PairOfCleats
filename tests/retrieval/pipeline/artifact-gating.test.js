#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  REQUIRED_ARTIFACTS,
  resolveRequiredArtifacts
} from '../../../src/retrieval/cli/required-artifacts.js';
import { buildTestPlan, createPlanInputs } from './query-plan-helpers.js';

process.env.PAIROFCLEATS_TESTING = '1';

const importInputs = createPlanInputs({ searchImport: 'react' });
const importPlan = buildTestPlan(importInputs);
const importRequired = resolveRequiredArtifacts({
  queryPlan: importPlan,
  contextExpansionEnabled: false,
  contextExpansionRespectFilters: true,
  graphRankingEnabled: false,
  annActive: false
});

assert.ok(importRequired.has(REQUIRED_ARTIFACTS.FILTER_INDEX), 'expected filterIndex requirement');
assert.ok(importRequired.has(REQUIRED_ARTIFACTS.FILE_RELATIONS), 'expected fileRelations requirement');
assert.ok(!importRequired.has(REQUIRED_ARTIFACTS.REPO_MAP), 'did not expect repoMap requirement');

const contextInputs = createPlanInputs();
const contextPlan = buildTestPlan(contextInputs);
const contextRequired = resolveRequiredArtifacts({
  queryPlan: contextPlan,
  contextExpansionEnabled: true,
  contextExpansionOptions: {},
  contextExpansionRespectFilters: true,
  graphRankingEnabled: false,
  annActive: false
});

assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.REPO_MAP), 'expected repoMap requirement');
assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.GRAPH_RELATIONS), 'expected graphRelations requirement');
assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.FILE_RELATIONS), 'expected fileRelations requirement');
assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.CONTEXT_INDEX), 'expected contextIndex requirement');

const annRequired = resolveRequiredArtifacts({
  queryPlan: contextPlan,
  contextExpansionEnabled: false,
  graphRankingEnabled: false,
  annActive: true
});

assert.ok(annRequired.has(REQUIRED_ARTIFACTS.ANN), 'expected ann requirement');

console.log('artifact gating test passed');
