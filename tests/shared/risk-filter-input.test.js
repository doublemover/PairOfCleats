#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskFilterInput, normalizeRiskFilters } from '../../src/shared/risk-filters.js';

const canonical = buildRiskFilterInput({
  rule: 'sink.sql.query',
  category: 'sql-injection',
  severity: 'high',
  tag: 'sql',
  source: 'req body',
  sink: 'db.query',
  flowId: 'sha1:abc',
  sourceRule: 'source.req.body',
  sinkRule: 'sink.sql.query'
});

assert.deepEqual(canonical, {
  rule: 'sink.sql.query',
  category: 'sql-injection',
  severity: 'high',
  tag: 'sql',
  source: 'req body',
  sink: 'db.query',
  flowId: 'sha1:abc',
  sourceRule: 'source.req.body',
  sinkRule: 'sink.sql.query'
});

const aliased = buildRiskFilterInput({
  rule: 'sink.sql.query',
  category: 'sql-injection',
  severity: 'high',
  tag: 'sql',
  source: 'req body',
  sink: 'db.query',
  'flow-id': 'sha1:abc',
  'source-rule': 'source.req.body',
  'sink-rule': 'sink.sql.query'
});

assert.deepEqual(aliased, canonical);
assert.deepEqual(normalizeRiskFilters(aliased), {
  rule: ['sink.sql.query'],
  category: ['sql-injection'],
  severity: ['high'],
  tag: ['sql'],
  source: ['req body'],
  sink: ['db.query'],
  sourceRule: ['source.req.body'],
  sinkRule: ['sink.sql.query'],
  flowId: ['sha1:abc']
});

console.log('risk filter input test passed');
