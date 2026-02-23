#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRunSearchExecutionInput } from '../../../src/retrieval/cli/run-search/execution-input.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const input = {
  query: 'symbol:foo',
  searchMode: 'code',
  runCode: true,
  runProse: false,
  annActive: true,
  backendLabel: 'sqlite',
  queryPlan: { filtersActive: true },
  profileWarnings: ['warning-a'],
  stageTracker: { enabled: true }
};

const output = buildRunSearchExecutionInput(input);

assert.notEqual(output, input);
assert.equal(output.query, 'symbol:foo');
assert.equal(output.searchMode, 'code');
assert.equal(output.annActive, true);
assert.equal(output.backendLabel, 'sqlite');
assert.equal(output.queryPlan, input.queryPlan);
assert.equal(output.profileWarnings, input.profileWarnings);
assert.equal(output.stageTracker, input.stageTracker);

output.query = 'changed';
assert.equal(input.query, 'symbol:foo', 'expected top-level object to be copied');

console.log('run-search execution input helper test passed');
