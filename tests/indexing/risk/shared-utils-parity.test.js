#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  containsIdentifier,
  matchRulePatterns,
  SEVERITY_RANK
} from '../../../src/index/risk/shared.js';

applyTestEnv();

assert.equal(SEVERITY_RANK.low, 1);
assert.equal(SEVERITY_RANK.critical, 4);

assert.equal(containsIdentifier('foo bar', 'foo'), true);
assert.equal(containsIdentifier('foobar', 'foo'), false);
assert.equal(containsIdentifier('foo_bar', 'foo'), false);
assert.equal(containsIdentifier('foo + bar', 'bar'), true);
assert.equal(containsIdentifier('x foo y', 'foo', { start: 2, end: 5 }), true);
assert.equal(containsIdentifier('x foo y', 'foo', { start: 0, end: 2 }), false);

const pattern = /danger\(/i;
pattern.prefilter = 'danger';
pattern.prefilterLower = 'danger';

const rule = { patterns: [pattern] };
const lineLowerRef = { value: null };
const match = matchRulePatterns('if (danger(input)) {}', rule, {
  returnMatch: true,
  lineLowerRef
});
assert.equal(typeof lineLowerRef.value, 'string');
assert.equal(match.index, 4);
assert.equal(match.match, 'danger(');

const noMatch = matchRulePatterns('safe(input)', rule, { returnMatch: true, lineLowerRef: { value: null } });
assert.equal(noMatch, null);
assert.equal(matchRulePatterns('safe(input)', rule), false);
assert.equal(matchRulePatterns('danger(input)', rule), true);

console.log('risk shared utils parity test passed');
