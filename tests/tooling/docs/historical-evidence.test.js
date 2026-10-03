#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  assertEvidenceAvailability,
  assertEvidencePassingProof,
  isHistoricalEvidencePath
} from './historical-evidence.js';

const historical = ['temp/validation/proof-20260521.log', 'temp/validation/proof-20260522.log'];
assert.equal(isHistoricalEvidencePath('temp\\validation\\proof-20260520.log'), true);
assert.equal(isHistoricalEvidencePath('.testLogs/run-1779415736438-zs5bxc'), true);
assert.equal(isHistoricalEvidencePath('temp/validation/proof-20261002.log'), false);
assert.equal(isHistoricalEvidencePath('temp/validation/current-proof.log'), false);
assert.equal(isHistoricalEvidencePath('.testLogs/run-1790905030558-a1sidz'), false);
assert.equal(isHistoricalEvidencePath('docs/roadmap.md'), false);
assert.equal(assertEvidenceAvailability(historical, () => false, 'absent checkpoint'), false);
assert.throws(() => assertEvidenceAvailability([], () => false, 'empty'), /has no references/);
assert.throws(
  () => assertEvidenceAvailability(['temp/validation/current-proof.log'], () => false, 'current'),
  /required evidence bundle is incomplete/
);
assert.throws(
  () => assertEvidenceAvailability(historical, (entry) => entry === historical[0], 'partial checkpoint'),
  /required evidence bundle is incomplete/
);
assert.throws(
  () => assertEvidenceAvailability(
    [...historical, '.testLogs/run-1779415736438-zs5bxc'],
    (entry) => entry.startsWith('.testLogs/'),
    'timings without checkpoint logs'
  ),
  /required evidence bundle is incomplete/
);
const available = assertEvidenceAvailability(historical, () => true, 'present checkpoint');
assert.equal(available, true);
assert.throws(() => assertEvidencePassingProof(available, false, 'malformed checkpoint'), /explicit passing proof/);
assertEvidencePassingProof(available, true, 'valid checkpoint');
console.log('historical evidence availability contract passed');
