#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../../tests/helpers/test-env.js';
import {
  customEmbeddingPolicies,
  familyEdgeKinds,
  familyNodeKinds,
  languageBaselines
} from './datasets-language-families.mjs';
import {
  edgeKindConstraints,
  frameworkEdgeCases,
  frameworkProfiles,
  nodeKindMappings
} from './datasets-framework-families.mjs';

ensureTestingEnv(process.env);

/**
 * @param {string[]} values
 * @param {string} label
 * @returns {void}
 */
function assertSortedStrings(values, label) {
  assert.deepEqual(values, [...values].sort(), `${label} must stay lexically sorted`);
}

for (const baseline of languageBaselines) {
  assertSortedStrings(baseline.frameworkProfiles, `${baseline.id}.frameworkProfiles`);
  assertSortedStrings(baseline.dialects, `${baseline.id}.dialects`);
  assertSortedStrings(baseline.featureFlags, `${baseline.id}.featureFlags`);
}

for (const [family, kinds] of Object.entries(familyNodeKinds)) {
  assertSortedStrings(kinds, `familyNodeKinds.${family}`);
}

for (const [family, kinds] of Object.entries(familyEdgeKinds)) {
  assertSortedStrings(kinds, `familyEdgeKinds.${family}`);
}

for (const [languageId, policy] of Object.entries(customEmbeddingPolicies)) {
  assertSortedStrings(policy.embeddedLanguageAllowlist, `customEmbeddingPolicies.${languageId}.embeddedLanguageAllowlist`);
}

assert.deepEqual(
  frameworkProfiles.map((profile) => profile.id),
  [...frameworkProfiles.map((profile) => profile.id)].sort(),
  'frameworkProfiles must remain sorted by id'
);

assert.deepEqual(
  frameworkEdgeCases.map((edgeCase) => edgeCase.id),
  [...frameworkEdgeCases.map((edgeCase) => edgeCase.id)].sort(),
  'frameworkEdgeCases must remain sorted by id'
);

assert.deepEqual(
  edgeKindConstraints.map((constraint) => constraint.edgeKind),
  [...edgeKindConstraints.map((constraint) => constraint.edgeKind)].sort(),
  'edgeKindConstraints must remain sorted by edgeKind'
);

const sortedNodeKindMappings = [...nodeKindMappings].sort((a, b) => {
  if (a.languageId !== b.languageId) return a.languageId.localeCompare(b.languageId);
  if (a.parserSource !== b.parserSource) return a.parserSource.localeCompare(b.parserSource);
  if (a.rawKind !== b.rawKind) return a.rawKind.localeCompare(b.rawKind);
  return a.priority - b.priority;
});

assert.deepEqual(
  nodeKindMappings,
  sortedNodeKindMappings,
  'nodeKindMappings must remain sorted by language/parser/rawKind/priority'
);

console.log('datasets catalog ordering tests passed');
