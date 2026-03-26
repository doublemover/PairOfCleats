#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createContextPackValidator,
  createRiskDeltaValidator,
  createRiskExplainValidator
} from '../../../tools/api/validation.js';

const validateContextPackPayload = createContextPackValidator();
const validateRiskDeltaPayload = createRiskDeltaValidator();
const validateRiskExplainPayload = createRiskExplainValidator();

for (const select of [
  'repo-a',
  ['repo-a', 'repo-b'],
  { repos: ['repo-a'], includeDisabled: true }
]) {
  const validation = validateContextPackPayload({
    workspacePath: 'C:\\workspace\\.pairofcleats-workspace.jsonc',
    seed: 'chunk:test',
    hops: 0,
    select
  });
  assert.deepEqual(validation, { ok: true }, `expected context-pack validator to accept select=${JSON.stringify(select)}`);
}

const dashedFilters = {
  'flow-id': 'flow-1',
  'source-rule': 'source.rule',
  'sink-rule': 'sink.rule'
};

assert.deepEqual(
  validateContextPackPayload({
    seed: 'chunk:test',
    hops: 0,
    filters: dashedFilters
  }),
  { ok: true },
  'expected context-pack validator to accept dashed risk filter keys'
);

assert.deepEqual(
  validateRiskExplainPayload({
    chunk: 'chunk:test',
    filters: dashedFilters
  }),
  { ok: true },
  'expected risk-explain validator to accept dashed risk filter keys'
);

assert.deepEqual(
  validateRiskDeltaPayload({
    seed: 'chunk:test',
    from: 'build:a',
    to: 'build:b',
    filters: dashedFilters
  }),
  { ok: true },
  'expected risk-delta validator to accept dashed risk filter keys'
);

console.log('API analysis validation compatibility test passed');
