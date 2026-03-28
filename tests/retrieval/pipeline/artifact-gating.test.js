#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import {
  REQUIRED_ARTIFACTS,
  resolveRequiredArtifacts
} from '../../../src/retrieval/cli/required-artifacts.js';
import { buildTestPlan, createPlanInputs } from './query-plan-helpers.js';

applyTestEnv();

const cases = [
  {
    name: 'imports, context expansion, and ann each request the right artifacts',
    run() {
      const importInputs = createPlanInputs({ searchImport: 'react' });
      const importPlan = buildTestPlan(importInputs);
      const importRequired = resolveRequiredArtifacts({
        queryPlan: importPlan,
        contextExpansionEnabled: false,
        contextExpansionRespectFilters: true,
        graphRankingEnabled: false,
        annActive: false
      });

      assert.ok(importRequired.has(REQUIRED_ARTIFACTS.FILTER_INDEX));
      assert.ok(importRequired.has(REQUIRED_ARTIFACTS.FILE_RELATIONS));
      assert.ok(!importRequired.has(REQUIRED_ARTIFACTS.REPO_MAP));

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

      assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.REPO_MAP));
      assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.GRAPH_RELATIONS));
      assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.FILE_RELATIONS));
      assert.ok(contextRequired.has(REQUIRED_ARTIFACTS.CONTEXT_INDEX));

      const annRequired = resolveRequiredArtifacts({
        queryPlan: contextPlan,
        contextExpansionEnabled: false,
        graphRankingEnabled: false,
        annActive: true
      });
      assert.ok(annRequired.has(REQUIRED_ARTIFACTS.ANN));
    }
  },
  {
    name: 'artifact dependency closure keeps graph relations for export-only expansion',
    run() {
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

      assert.ok(required.has(REQUIRED_ARTIFACTS.REPO_MAP));
      assert.ok(required.has(REQUIRED_ARTIFACTS.GRAPH_RELATIONS));
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('artifact gating test passed');
