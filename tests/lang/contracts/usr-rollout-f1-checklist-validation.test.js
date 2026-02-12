#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestsPresent, checklistLineState, extractSection, hasUnchecked } from './usr-lock-test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const rolloutSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-rollout-release-migration.md');
const rolloutLockPath = path.join(repoRoot, 'docs', 'specs', 'usr-rollout-approval-lock.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const rolloutLockText = fs.readFileSync(rolloutLockPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const f1Section = extractSection(
  roadmapText,
  '### F.1 Rollout gates (USR section 26)',
  '### F.2 Backward compatibility and deprecation (USR section 27)'
);

const gateASection = extractSection(
  roadmapText,
  '### Gate A (B0 contracts/registries)',
  '### Gate B1-B7 (language batch gates)'
);
const gateCSection = extractSection(
  roadmapText,
  '### Gate C (test rollout)',
  '---\n\n## Appendix C - Exhaustive Per-Language Task Packs by Batch'
);
const phase9ExitSection = extractSection(
  roadmapText,
  '### 9.3 Exit criteria',
  '## Phase 10 - Harness and Lane Materialization'
);

const phaseA = checklistLineState(f1Section, 'Complete Phase A schema and registry readiness.');
const phaseB = checklistLineState(f1Section, 'Complete Phase B dual-write parity validation.');
const phaseC = checklistLineState(f1Section, 'Complete Phase C USR-backed production path validation.');
const phaseD = checklistLineState(f1Section, 'Complete Phase D full conformance enforcement.');

const readinessReportApproved = checklistLineState(phase9ExitSection, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase9ExitSection, 'Test rollout authorized.');
const allPriorGatesPass = checklistLineState(gateCSection, 'all prior gates pass.');
const conformanceRolloutAuthorized = checklistLineState(gateCSection, 'conformance rollout authorized.');

if (phaseA === 'checked') {
  assert.equal(hasUnchecked(gateASection), false, 'Phase A cannot be checked while Gate A has unchecked items');
}

if (phaseB === 'checked') {
  assert.equal(phaseA, 'checked', 'Phase B cannot be checked before Phase A');
}

if (phaseC === 'checked') {
  assert.equal(phaseA, 'checked', 'Phase C cannot be checked before Phase A');
  assert.equal(phaseB, 'checked', 'Phase C cannot be checked before Phase B');
  assert.equal(readinessReportApproved, 'checked', 'Phase C requires Readiness report approved to be checked');
  assert.equal(testRolloutAuthorized, 'checked', 'Phase C requires Test rollout authorized to be checked');
  assert.equal(allPriorGatesPass, 'checked', 'Phase C requires Gate C all prior gates pass to be checked');
}

const lockStateMatch = rolloutLockText.match(/^Approval state:\s+`([^`]+)`$/m);
assert.notEqual(lockStateMatch, null, 'rollout approval lock must declare Approval state');
const rolloutLockState = lockStateMatch[1].trim();
assert.equal(['pending', 'approved'].includes(rolloutLockState), true, `rollout approval lock state must be pending|approved, received: ${rolloutLockState}`);

if (phaseD === 'checked') {
  assert.equal(phaseA, 'checked', 'Phase D cannot be checked before Phase A');
  assert.equal(phaseB, 'checked', 'Phase D cannot be checked before Phase B');
  assert.equal(phaseC, 'checked', 'Phase D cannot be checked before Phase C');
  assert.equal(allPriorGatesPass, 'checked', 'Phase D requires Gate C all prior gates pass to be checked');
  assert.equal(conformanceRolloutAuthorized, 'checked', 'Phase D requires Gate C conformance rollout authorized to be checked');
  assert.equal(rolloutLockState, 'approved', 'Phase D cannot be checked while rollout approval lock is pending');
}

if (rolloutLockState === 'pending') {
  assert.equal(phaseD, 'unchecked', 'Phase D must remain unchecked while rollout approval lock is pending');
}

for (const fragment of [
  'Appendix F.1 checklist promotion lock requirements:',
  'Phase A can only be checked after Gate A checklist is fully checked.',
  'Phase D can only be checked after Phase A/B/C are checked, Gate C `all prior gates pass.` and `conformance rollout authorized.` are checked, and rollout approval lock state is `approved`.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing F.1 checklist lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.9 Appendix F.1 phase-promotion lock'), true, 'roadmap must include Appendix N.9 F.1 phase-promotion lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-rollout-f1-checklist-validation',
    'lang/contracts/usr-rollout-phase-evidence-lock-validation',
    'lang/contracts/usr-rollout-phase-gate-validation',
    'lang/contracts/usr-rollout-approval-lock-validation'
  ],
  'rollout F.1 checklist governance test',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr rollout F.1 checklist validation checks passed');
