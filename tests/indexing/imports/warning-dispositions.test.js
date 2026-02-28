import assert from 'node:assert/strict';
import {
  isActionableImportWarning,
  isParserArtifactImportWarning,
  isResolverGapImportWarning,
  summarizeImportWarningDispositions
} from '../../../src/index/build/import-resolution/disposition.js';

assert.equal(isActionableImportWarning({ disposition: 'actionable' }), true);
assert.equal(isActionableImportWarning({ disposition: 'suppress_live' }), false);
assert.equal(isActionableImportWarning({ disposition: ' suppress_gate ' }), false);

assert.equal(isParserArtifactImportWarning({ failureCause: 'parser_artifact' }), true);
assert.equal(isResolverGapImportWarning({ failureCause: 'resolver_gap' }), true);

assert.equal(
  isParserArtifactImportWarning({ category: 'parser_artifact' }),
  true,
  'category fallback should support replay payloads missing failureCause'
);
assert.equal(
  isParserArtifactImportWarning({ category: 'parser_artifact' }, { allowCategoryFallback: false }),
  false,
  'category fallback should be opt-out for strict callsites'
);

const summary = summarizeImportWarningDispositions([
  { disposition: 'actionable', failureCause: 'missing_file' },
  { disposition: 'suppress_live', failureCause: 'parser_artifact' },
  { disposition: 'suppress_gate', failureCause: 'resolver_gap' },
  { disposition: 'actionable', category: 'resolver_gap' }
]);

assert.deepEqual(summary, {
  actionable: 2,
  parserArtifact: 1,
  resolverGap: 2
});

console.log('import warning disposition helpers test passed');
