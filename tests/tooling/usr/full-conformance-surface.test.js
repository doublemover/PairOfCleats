#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildUsrConformanceSurface } from '../../../tools/usr/conformance-surface.js';

const result = await buildUsrConformanceSurface({
  now: () => '2026-05-22T00:00:00.000Z'
});

assert.equal(result.ok, true, `expected full conformance surface to pass: ${result.errors.join('; ')}`);
assert.equal(
  result.reportValidation.ok,
  true,
  `expected USR report validation to pass: ${result.reportValidation.errors.join('; ')}`
);

const payload = result.payload;
assert.equal(payload.artifactId, 'usr-conformance-summary');
assert.equal(payload.status, 'pass');
assert.equal(payload.summary.dashboard, 'full-language-conformance-surface');
assert.ok(payload.summary.languageProfileCount > 0, 'expected language profile coverage');
assert.ok(payload.summary.frameworkProfileCount > 0, 'expected framework profile coverage');
assert.ok(payload.summary.artifactExpectationRowCount > 0, 'expected artifact expectation coverage');
assert.equal(payload.summary.selectorCount, 9, 'expected one selector per language shard');
assert.ok(
  payload.summary.selectors.includes('conformance/language-shards/foundation/validation'),
  'expected foundation language shard selector'
);
assert.equal(payload.rows.length, payload.summary.profileCount, 'expected row count to match profile count');
assert.equal(
  payload.rows.every((row) => row.pass === true),
  true,
  'expected every conformance surface row to pass'
);

console.log('usr full conformance surface test passed');
