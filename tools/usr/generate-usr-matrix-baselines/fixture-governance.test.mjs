#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../../tests/helpers/test-env.js';
import { buildFixtureGovernance, roadmapTagsForFixture } from './fixture-governance.mjs';

ensureTestingEnv(process.env);

const supplementalRow = {
  fixtureId: 'usr::integration::perf-001',
  profileType: 'cross-cutting',
  profileId: 'usr',
  conformanceLevels: ['C1', 'C2'],
  families: ['integration', 'api-boundary', 'data-boundary', 'performance', 'backcompat'],
  owner: 'usr-conformance',
  reviewers: ['usr-architecture'],
  stabilityClass: 'stable',
  mutationPolicy: 'require-review',
  goldenRequired: true,
  blocking: true
};

const rows = buildFixtureGovernance({
  languageBaselines: [
    { id: 'json', requiredConformance: ['C0', 'C1', 'C2'] },
    { id: 'typescript', requiredConformance: ['C0', 'C1', 'C2', 'C3', 'C4'] }
  ],
  frameworkProfiles: [
    {
      id: 'vue',
      requiredConformance: ['C4'],
      bindingSemantics: {
        requiredEdgeKinds: ['template_binds', 'template_emits', 'style_scopes', 'route_maps_to', 'hydration_boundary']
      }
    }
  ],
  supplementalRows: [supplementalRow]
});

const fixtureIds = rows.map((row) => row.fixtureId);
assert.deepEqual(fixtureIds, [...fixtureIds].sort(), 'expected fixture governance rows sorted by fixtureId');

const jsonConfigFixture = rows.find((row) => row.fixtureId === 'json::config::nested-objects-001');
assert.ok(jsonConfigFixture, 'expected generated config fixture for json');
assert.deepEqual(jsonConfigFixture.families, ['config', 'golden', 'language-baseline', 'semantic-flow']);
assert.deepEqual(jsonConfigFixture.roadmapTags, ['appendix-c:json', 'phase-4', 'phase-6', 'phase-7']);

const typescriptBaselineFixture = rows.find((row) => row.fixtureId === 'typescript::baseline::coverage-001');
assert.ok(typescriptBaselineFixture, 'expected generated baseline fixture for typescript');
assert.deepEqual(typescriptBaselineFixture.families, ['framework-overlay', 'golden', 'language-baseline', 'risk', 'semantic-flow']);
assert.deepEqual(typescriptBaselineFixture.roadmapTags, ['appendix-c:typescript', 'phase-4', 'phase-5', 'phase-6', 'phase-7']);

const vueFrameworkFixture = rows.find((row) => row.fixtureId === 'vue::framework-overlay::baseline-001');
assert.ok(vueFrameworkFixture, 'expected generated framework fixture for vue');
assert.deepEqual(vueFrameworkFixture.families, ['framework-overlay', 'hydration', 'route-semantics', 'style-scope', 'template-binding']);
assert.deepEqual(vueFrameworkFixture.roadmapTags, ['appendix-d:vue', 'phase-5', 'phase-7']);

const supplementalFixture = rows.find((row) => row.fixtureId === supplementalRow.fixtureId);
assert.ok(supplementalFixture, 'expected supplemental fixture to be included');
assert.deepEqual(supplementalFixture.roadmapTags, ['phase-10', 'phase-14', 'phase-7', 'phase-8', 'phase-9']);

assert.deepEqual(
  roadmapTagsForFixture({
    profileType: 'framework',
    profileId: 'astro',
    families: ['framework-overlay', 'risk', 'failure-injection']
  }),
  ['appendix-d:astro', 'phase-14', 'phase-5', 'phase-6', 'phase-7'],
  'expected roadmap tag derivation to be lexical and deduplicated'
);

console.log('fixture governance generation tests passed');
