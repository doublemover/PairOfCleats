import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { BASELINE_INDEX_FILES, BASELINE_NEGATIVE_CASES, createBaselinePrerequisites } from '../helpers/baseline-prerequisites.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('smoke/baseline-negative/')[1];
assert.ok(BASELINE_NEGATIVE_CASES.includes(selected), 'run one independently bounded discovered prerequisite case');
const script = fileURLToPath(new URL('./baseline.test.js', import.meta.url));
const fixture = await createBaselinePrerequisites(process.cwd(), script, BASELINE_INDEX_FILES);
try { await fixture.verifyNegatives(selected); }
finally { await fixture.cleanup(); }
console.log(`Baseline prerequisite case ${selected} retains its original real diagnostic assertions and deadlines`);
