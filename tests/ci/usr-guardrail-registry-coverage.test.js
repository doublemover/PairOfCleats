#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { USR_GUARDRAIL_GATES, validateUsrGuardrailGates } from '../../tools/ci/usr/guardrails.js';

ensureTestingEnv(process.env);

validateUsrGuardrailGates();

assert.ok(Array.isArray(USR_GUARDRAIL_GATES), 'USR guardrail registry must be an array');
assert.ok(USR_GUARDRAIL_GATES.length > 0, 'USR guardrail registry must not be empty');

const seenItems = new Set();
for (const gate of USR_GUARDRAIL_GATES) {
  assert.equal(Number.isInteger(gate.item), true, 'guardrail item must be integer');
  assert.equal(seenItems.has(gate.item), false, `duplicate guardrail item ${gate.item}`);
  seenItems.add(gate.item);
  assert.equal(typeof gate.label, 'string');
  assert.equal(Boolean(gate.label.trim()), true, `missing label for item ${gate.item}`);
  assert.equal(typeof gate.scope, 'string');
  assert.equal(Boolean(gate.scope.trim()), true, `missing scope for item ${gate.item}`);
  assert.equal(typeof gate.script, 'string');
  assert.equal(Boolean(gate.script.trim()), true, `missing script for item ${gate.item}`);
  assert.equal(typeof gate.report, 'string');
  assert.equal(Boolean(gate.report.trim()), true, `missing report for item ${gate.item}`);
  assert.equal(typeof gate.remediationCommand, 'string');
  assert.equal(Boolean(gate.remediationCommand.trim()), true, `missing remediation for item ${gate.item}`);
  assert.equal(
    gate.remediationCommand.includes(gate.script),
    true,
    `remediation command must reference script for item ${gate.item}`
  );
}

console.log('USR guardrail registry coverage test passed');
