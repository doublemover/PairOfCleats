#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  buildGeneratedPolicyConfig,
  buildGeneratedPolicyDowngradePayload,
  GENERATED_POLICY_REASON_CODE,
  resolveGeneratedPolicyDecision
} from '../../../src/index/build/generated-policy.js';

applyTestEnv();

const basePolicy = buildGeneratedPolicyConfig({
  generatedPolicy: {
    include: ['src/generated/full/**'],
    exclude: ['src/generated/full/force-metadata/**']
  }
});

const minifiedDefault = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'src/app.min.js'
});
assert.equal(minifiedDefault?.downgrade, true, 'minified files should default to metadata-only');
assert.equal(minifiedDefault?.classification, 'minified');
assert.equal(minifiedDefault?.source, 'filename-pattern');

const minifiedDocumentDefault = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'docs/report.min.pdf'
});
assert.equal(
  minifiedDocumentDefault,
  null,
  'document extraction inputs (.pdf/.docx) should not be downgraded by minified-name heuristics'
);

const vendorDefault = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'vendor/sdk/index.js'
});
assert.equal(vendorDefault?.downgrade, true, 'vendor files should default to metadata-only');
assert.equal(vendorDefault?.classification, 'vendor');
assert.equal(vendorDefault?.source, 'path-pattern');

const vendorDefaultWithoutPolicyObject = resolveGeneratedPolicyDecision({
  relPath: 'vendor/sdk/index.js'
});
assert.equal(
  vendorDefaultWithoutPolicyObject?.downgrade,
  true,
  'generated policy defaults must apply even when policy object is omitted'
);
assert.equal(vendorDefaultWithoutPolicyObject?.classification, 'vendor');
assert.equal(vendorDefaultWithoutPolicyObject?.source, 'path-pattern');

const generatedDefault = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'src/models/generated/types.generated.ts'
});
assert.equal(generatedDefault?.downgrade, true, 'generated files should default to metadata-only');
assert.equal(generatedDefault?.classification, 'generated');

const includeOverride = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'src/generated/full/keep.min.js'
});
assert.equal(includeOverride?.downgrade, false, 'include patterns should force full indexing');
assert.equal(includeOverride?.policy, 'include');
assert.equal(includeOverride?.indexMode, 'full');

const excludeWins = resolveGeneratedPolicyDecision({
  generatedPolicy: basePolicy,
  relPath: 'src/generated/full/force-metadata/keep.min.js'
});
assert.equal(excludeWins?.downgrade, true, 'exclude patterns must win over include patterns');
assert.equal(excludeWins?.policy, 'exclude');
assert.equal(excludeWins?.source, 'explicit-policy');

const payloadA = buildGeneratedPolicyDowngradePayload(excludeWins);
const payloadB = buildGeneratedPolicyDowngradePayload(excludeWins);
assert.deepEqual(payloadA, payloadB, 'downgrade payload must be deterministic');
assert.equal(payloadA?.reasonCode, GENERATED_POLICY_REASON_CODE);
assert.equal(payloadA?.indexMode, 'metadata-only');

console.log('generated policy matrix test passed');
