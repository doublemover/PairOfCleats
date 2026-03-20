#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildExtractedProseLowYieldHistory } from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';
import {
  buildExtractedProseRepoFingerprint,
  compareRepoFingerprintShape
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose/fingerprint.js';

const fingerprint = buildExtractedProseRepoFingerprint([
  { rel: 'docs/a.md', ext: '.md' },
  { rel: 'docs/b.md', ext: '.md' },
  { rel: 'generated/schema.js', ext: '.js' }
]);

assert.equal(fingerprint.cohortCounts['docs-markdown'], 2);
assert.equal(fingerprint.cohortCounts['generated-machine'], 1);

const history = buildExtractedProseLowYieldHistory({
  builds: 3,
  observedFiles: 6,
  yieldedFiles: 2,
  chunkCount: 3,
  families: {
    '.md|docs': { observedFiles: 4, yieldedFiles: 2, chunkCount: 3 },
    '.js|generated': { observedFiles: 2, yieldedFiles: 0, chunkCount: 0 }
  },
  fingerprint
});

assert.equal(history.cohorts['docs-markdown'].yieldedFiles, 2);
assert.equal(history.cohorts['generated-machine'].observedFiles, 2);
assert.equal(
  compareRepoFingerprintShape({
    current: fingerprint,
    previous: {
      totalEntries: 3,
      docLikeEntries: 0,
      dominantCohort: 'generated-machine',
      cohortCounts: {
        'docs-markdown': 0,
        'tests-examples': 0,
        'templates-config': 0,
        'generated-machine': 3,
        'code-comment-heavy': 0
      }
    },
    cohortKey: 'docs-markdown'
  }),
  true
);

console.log('extracted prose low-yield fingerprint and history test passed');
