#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  projectCliRiskDeltaRequest,
  projectCliRiskExplainRequest,
  projectRiskDeltaRequest,
  projectRiskExplainRequest
} from '../../tools/analysis/risk-request.js';

const apiExplain = projectRiskExplainRequest({
  chunk: ' chunk:abc ',
  max: 5,
  includePartialFlows: 'true',
  maxPartialFlows: 2,
  filters: {
    tags: 'http',
    flow_id: 'flow-1',
    'source-rule': 'source.request',
    severity: 'high'
  }
});

assert.equal(apiExplain.chunkUid, 'chunk:abc');
assert.equal(apiExplain.max, 5);
assert.equal(apiExplain.includePartialFlows, false, 'API/MCP projection must preserve strict boolean semantics');
assert.equal(apiExplain.maxPartialFlows, 2);
assert.equal(apiExplain.filterValidation.ok, true);
assert.deepEqual(apiExplain.filters, {
  rule: [],
  category: [],
  severity: ['high'],
  tag: ['http'],
  source: [],
  sink: [],
  sourceRule: ['source.request'],
  sinkRule: [],
  flowId: ['flow-1']
});

const cliExplain = projectCliRiskExplainRequest({
  chunk: 'chunk:def',
  includePartialFlows: true,
  severity: 'critical',
  'flow-id': 'flow-2',
  sourceRule: 'source.cli'
});

assert.equal(cliExplain.chunkUid, 'chunk:def');
assert.equal(cliExplain.includePartialFlows, true);
assert.equal(cliExplain.filterValidation.ok, true);
assert.deepEqual(cliExplain.filters.severity, ['critical']);
assert.deepEqual(cliExplain.filters.flowId, ['flow-2']);
assert.deepEqual(cliExplain.filters.sourceRule, ['source.cli']);

const apiDelta = projectRiskDeltaRequest({
  from: ' main ',
  to: ' HEAD ',
  seed: ' chunk:abc ',
  includePartialFlows: true,
  filters: {
    severity: 'urgent'
  }
});

assert.equal(apiDelta.fromRef, 'main');
assert.equal(apiDelta.toRef, 'HEAD');
assert.equal(apiDelta.seed, 'chunk:abc');
assert.equal(apiDelta.includePartialFlows, true);
assert.equal(apiDelta.filterValidation.ok, false);
assert.match(apiDelta.filterValidation.errors.join('; '), /severity must be one of/i);

const cliDelta = projectCliRiskDeltaRequest({
  from: 'a',
  to: 'b',
  seed: 'chunk:z',
  includePartialFlows: 1,
  source_rule: 'source.alias',
  sinkRule: 'sink.alias'
});

assert.equal(cliDelta.includePartialFlows, false, 'CLI projection must also require a literal true boolean');
assert.deepEqual(cliDelta.filters.sourceRule, ['source.alias']);
assert.deepEqual(cliDelta.filters.sinkRule, ['sink.alias']);

console.log('analysis risk request contract test passed');
