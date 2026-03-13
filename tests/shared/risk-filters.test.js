#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  filterRiskFlows,
  normalizeRiskFilters,
  validateRiskFilters
} from '../../src/shared/risk-filters.js';

const normalized = normalizeRiskFilters({
  rule: 'sink.sql.query,source.req.body',
  severity: ['HIGH', 'critical'],
  tag: ['sql', 'command-exec'],
  source: 'req body',
  sink: 'sql query',
  sinkRule: 'sink.sql.query',
  flowId: 'sha1:abc'
});

assert.deepEqual(normalized, {
  rule: ['sink.sql.query', 'source.req.body'],
  category: [],
  severity: ['high', 'critical'],
  tag: ['sql', 'command-exec'],
  source: ['req body'],
  sink: ['sql query'],
  sourceRule: [],
  sinkRule: ['sink.sql.query'],
  flowId: ['sha1:abc']
});

assert.deepEqual(validateRiskFilters(normalized), { ok: true, errors: [] });
assert.equal(validateRiskFilters({ severity: ['urgent'] }).ok, false);

const flows = [
  {
    flowId: 'sha1:abc',
    category: 'sql-injection',
    severity: 'high',
    source: { ruleId: 'source.req.body', ruleName: 'req body', name: 'request.body', category: 'input', severity: 'low', tags: ['user-input'] },
    sink: { ruleId: 'sink.sql.query', ruleName: 'sql query', name: 'db.query', category: 'sql-injection', severity: 'high', tags: ['sql', 'command-exec'] }
  },
  {
    flowId: 'sha1:def',
    category: 'logging',
    severity: 'low',
    source: { ruleId: 'source.other', ruleName: 'other', name: 'config.value', category: 'input', severity: 'low', tags: ['config'] },
    sink: { ruleId: 'sink.log', ruleName: 'log', name: 'logger.info', category: 'logging', severity: 'low', tags: ['logging'] }
  }
];

assert.deepEqual(filterRiskFlows(flows, normalized).map((flow) => flow.flowId), ['sha1:abc']);

console.log('risk filters test passed');
