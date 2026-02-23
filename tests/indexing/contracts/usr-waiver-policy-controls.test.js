#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsrWaiverPolicyControls } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const waiverPolicyPayload = readMatrix('usr-waiver-policy.json');
const ownershipMatrixPayload = readMatrix('usr-ownership-matrix.json');
const escalationPolicyPayload = readMatrix('usr-escalation-policy.json');

const sourceRow = waiverPolicyPayload.rows.find((row) => row.blocking === false) ?? waiverPolicyPayload.rows[0];
const contractRow = structuredClone(sourceRow);
contractRow.id = `${sourceRow.id}-contract-check`;
contractRow.blocking = false;
contractRow.allowedUntil = '2026-01-01T00:00:00Z';
contractRow.requiredCompensatingControls = ['usr-unknown-compensating-control.json'];

const contractPayload = {
  ...waiverPolicyPayload,
  rows: [contractRow]
};

const nonStrictValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: contractPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime: '2026-02-01T00:00:00Z',
  strictMode: false
});

assert.equal(nonStrictValidation.ok, true, 'expected non-strict waiver validation to downgrade controllable issues to warnings');
assert.equal(nonStrictValidation.errors.length, 0, 'expected no non-strict blocking errors for expired/unknown compensating control');
assert(
  nonStrictValidation.warnings.some((entry) => entry.includes('compensating control does not map to a governed report artifact')),
  'expected non-strict warning for unknown compensating control artifact'
);
assert(
  nonStrictValidation.warnings.some((entry) => entry.includes('waiver is expired at evaluationTime=2026-02-01T00:00:00.000Z')),
  'expected non-strict warning for expired waiver'
);

const strictValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: contractPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime: '2026-02-01T00:00:00Z',
  strictMode: true
});

assert.equal(strictValidation.ok, false, 'expected strict waiver validation to fail for expired/unknown compensating control');
assert(
  strictValidation.errors.some((entry) => entry.includes('compensating control does not map to a governed report artifact')),
  'expected strict blocking error for unknown compensating control artifact'
);
assert(
  strictValidation.errors.some((entry) => entry.includes('waiver is expired at evaluationTime=2026-02-01T00:00:00.000Z')),
  'expected strict blocking error for expired waiver'
);

console.log('usr waiver policy controls test passed');
