#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';

process.env.PAIROFCLEATS_TESTING = '1';

const validManifest = {
  version: 1,
  updatedAt: '2026-02-12T00:00:00.000Z',
  diffs: {
    diff_abc123: {
      id: 'diff_abc123',
      createdAt: '2026-02-12T00:00:00.000Z',
      from: { snapshotId: 'snap-20260212-old', ref: 'snap:snap-20260212-old' },
      to: { snapshotId: 'snap-20260212-new', ref: 'snap:snap-20260212-new' },
      modes: ['code', 'prose'],
      summaryPath: 'diffs/diff_abc123/summary.json',
      eventsPath: 'diffs/diff_abc123/events.jsonl',
      truncated: false
    }
  }
};
const manifestResult = validateArtifact('diffs_manifest', validManifest);
assert.ok(manifestResult.ok, `diffs_manifest should validate: ${manifestResult.errors?.join('; ')}`);

const invalidManifest = {
  ...validManifest,
  diffs: {
    bad: {
      id: 'bad',
      createdAt: '2026-02-12T00:00:00.000Z',
      from: {},
      to: {},
      modes: ['code'],
      summaryPath: 'diffs/bad/summary.json'
    }
  }
};
const invalidManifestResult = validateArtifact('diffs_manifest', invalidManifest);
assert.ok(!invalidManifestResult.ok, 'diffs_manifest should reject invalid diff ids');

const validInputs = {
  id: 'diff_abc123',
  createdAt: '2026-02-12T00:00:00.000Z',
  from: { snapshotId: 'snap-20260212-old', ref: 'snap:snap-20260212-old' },
  to: { snapshotId: 'snap-20260212-new', ref: 'snap:snap-20260212-new' },
  modes: ['code', 'prose'],
  allowMismatch: false,
  identityHash: '70f3153ba6797f6a19454f548cd5968f2f2a5554',
  fromConfigHash: 'cfg-a',
  toConfigHash: 'cfg-b'
};
const inputsResult = validateArtifact('diff_inputs', validInputs);
assert.ok(inputsResult.ok, `diff_inputs should validate: ${inputsResult.errors?.join('; ')}`);

const invalidInputs = {
  ...validInputs,
  allowMismatch: 'false'
};
const invalidInputsResult = validateArtifact('diff_inputs', invalidInputs);
assert.ok(!invalidInputsResult.ok, 'diff_inputs should require boolean allowMismatch');

const validSummary = {
  id: 'diff_abc123',
  createdAt: '2026-02-12T00:00:00.000Z',
  from: { snapshotId: 'snap-20260212-old' },
  to: { snapshotId: 'snap-20260212-new' },
  modes: ['code', 'prose'],
  truncated: false,
  totals: {
    filesAdded: 1,
    filesRemoved: 2,
    filesModified: 3
  }
};
const summaryResult = validateArtifact('diff_summary', validSummary);
assert.ok(summaryResult.ok, `diff_summary should validate: ${summaryResult.errors?.join('; ')}`);

console.log('diff contracts test passed');

