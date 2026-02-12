#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

const checklistLineState = (section, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^- \\[x\\] ${escaped}$`, 'm').test(section)) return 'checked';
  if (new RegExp(`^- \\[ \\] ${escaped}$`, 'm').test(section)) return 'unchecked';
  assert.fail(`missing checklist line: ${label}`);
};

const hasUnchecked = (section) => /- \[ \] /.test(section);

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
const f1Section = extractSection(
  roadmapText,
  '### F.1 Rollout gates (USR section 26)',
  '### F.2 Backward compatibility and deprecation (USR section 27)'
);

const allPriorGatesPass = checklistLineState(gateCSection, 'all prior gates pass.');
const harnessMaterialized = checklistLineState(gateCSection, 'harness and lanes materialized.');
const conformanceRolloutAuthorized = checklistLineState(gateCSection, 'conformance rollout authorized.');

const readinessReportApproved = checklistLineState(phase9ExitSection, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase9ExitSection, 'Test rollout authorized.');

const phaseA = checklistLineState(f1Section, 'Complete Phase A schema and registry readiness.');
const phaseB = checklistLineState(f1Section, 'Complete Phase B dual-write parity validation.');
const phaseC = checklistLineState(f1Section, 'Complete Phase C USR-backed production path validation.');
const phaseD = checklistLineState(f1Section, 'Complete Phase D full conformance enforcement.');

const lockStateMatch = rolloutLockText.match(/^Approval state:\s+`([^`]+)`$/m);
assert.notEqual(lockStateMatch, null, 'rollout approval lock must declare Approval state');
const lockState = lockStateMatch[1].trim();
assert.equal(['pending', 'approved'].includes(lockState), true, `rollout approval lock state must be pending|approved, received: ${lockState}`);

const requiredRoles = ['usr-architecture', 'usr-conformance', 'usr-operations'];
const roleDecisions = new Map();
for (const role of requiredRoles) {
  const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowPattern = new RegExp(
    '^\\| `' + escapedRole + '` \\| (approved|pending|rejected) \\| (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z) \\|$',
    'm'
  );
  const rowMatch = rolloutLockText.match(rowPattern);
  assert.notEqual(rowMatch, null, `rollout approval lock missing role decision row: ${role}`);
  roleDecisions.set(role, rowMatch[1]);
}

if (conformanceRolloutAuthorized === 'checked') {
  assert.equal(allPriorGatesPass, 'checked', 'Gate C conformance rollout authorized requires all prior gates pass to be checked');
  assert.equal(harnessMaterialized, 'checked', 'Gate C conformance rollout authorized requires harness and lanes materialized to be checked');
  assert.equal(readinessReportApproved, 'checked', 'Gate C conformance rollout authorized requires Readiness report approved to be checked');
  assert.equal(testRolloutAuthorized, 'checked', 'Gate C conformance rollout authorized requires Test rollout authorized to be checked');
  assert.equal(phaseA, 'checked', 'Gate C conformance rollout authorized requires Appendix F.1 Phase A completion');
  assert.equal(phaseB, 'checked', 'Gate C conformance rollout authorized requires Appendix F.1 Phase B completion');
  assert.equal(phaseC, 'checked', 'Gate C conformance rollout authorized requires Appendix F.1 Phase C completion');
  assert.equal(lockState, 'approved', 'Gate C conformance rollout authorized cannot be checked while rollout approval lock is pending');
  assert.equal(hasUnchecked(gateCSection), false, 'Gate C conformance rollout authorized cannot be checked while Gate C still has unchecked lines');
  for (const role of requiredRoles) {
    assert.equal(roleDecisions.get(role), 'approved', `Gate C conformance rollout authorized requires approved rollout-lock role decision: ${role}`);
  }
}

if (lockState === 'pending') {
  assert.equal(conformanceRolloutAuthorized, 'unchecked', 'Gate C conformance rollout authorized must remain unchecked while rollout lock is pending');
  assert.equal(phaseD, 'unchecked', 'Appendix F.1 Phase D must remain unchecked while rollout lock is pending');
}

for (const fragment of [
  'Gate C conformance-authorization chain lock requirements:',
  '`conformance rollout authorized.` cannot be checked unless `all prior gates pass.` and `harness and lanes materialized.` are checked in Gate C.',
  '`conformance rollout authorized.` cannot be checked unless Appendix F.1 `Complete Phase A`, `Complete Phase B`, and `Complete Phase C` are checked and rollout approval lock state is `approved`.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing Gate C conformance-chain lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.13 Gate C conformance-authorization chain lock'), true, 'roadmap must include Appendix N.13 Gate C conformance-chain lock policy');

for (const testId of [
  'lang/contracts/usr-gate-c-authorization-chain-validation',
  'lang/contracts/usr-gate-c-prereq-lock-validation',
  'lang/contracts/usr-rollout-approval-lock-validation',
  'lang/contracts/usr-rollout-f1-checklist-validation',
  'lang/contracts/usr-phase9-readiness-authorization-lock-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing Gate C conformance-chain validator coverage: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing Gate C conformance-chain validator coverage: ${testId}`);
}

console.log('usr Gate C conformance-authorization chain validation checks passed');
