#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeOwnershipPayload,
  validateOwnershipPayload
} from './consolidation-ownership.js';

const payload = normalizeOwnershipPayload({
  schemaVersion: 1,
  suites: [
    {
      id: 'lang/contracts/language-fixture-contracts',
      suiteCategory: 'matrix',
      coverageOwner: 'Language fixture contract matrix.',
      replacementIds: ['lang/contracts/go', 'lang/contracts/go', 'lang/contracts/python'],
      overlapPolicy: 'legacy-removed-after-direct-parity',
      matrixStrategy: 'shared-fixture-index',
      processIsolationRequired: false
    }
  ]
});

assert.equal(payload.suites[0].replacementIds.length, 2);
assert.deepEqual(validateOwnershipPayload(payload), { valid: true, errors: [] });

const invalid = validateOwnershipPayload(normalizeOwnershipPayload({
  schemaVersion: 1,
  suites: [
    {
      id: 'a',
      suiteCategory: 'matrix',
      coverageOwner: 'owner a',
      replacementIds: ['legacy/shared'],
      overlapPolicy: 'parity',
      matrixStrategy: 'shared',
      processIsolationRequired: false
    },
    {
      id: 'b',
      suiteCategory: 'matrix',
      coverageOwner: 'owner b',
      replacementIds: ['legacy/shared'],
      overlapPolicy: 'parity',
      matrixStrategy: 'shared',
      processIsolationRequired: false
    }
  ]
}));
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.some((entry) => entry.includes('legacy/shared')));

console.log('consolidation ownership test passed');
