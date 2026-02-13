#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const lockPath = path.join(repoRoot, 'docs', 'specs', 'usr-rollout-approval-lock.md');
const rolloutSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-rollout-release-migration.md');
const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const lockText = fs.readFileSync(lockPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const extractChecklistState = (label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^- \\[x\\] ${escaped}$`, 'm').test(roadmapText)) return 'checked';
  if (new RegExp(`^- \\[ \\] ${escaped}$`, 'm').test(roadmapText)) return 'unchecked';
  assert.fail(`roadmap missing checklist line: ${label}`);
};

const approvalStateMatch = lockText.match(/^Approval state:\s+`([^`]+)`$/m);
assert.notEqual(approvalStateMatch, null, 'rollout approval lock must declare Approval state');
const approvalState = approvalStateMatch[1].trim();
assert.equal(['pending', 'approved'].includes(approvalState), true, `rollout approval state must be pending|approved, received: ${approvalState}`);

assert.equal(/^Approval record ID:\s+`usr-rollout-approval-[a-z0-9-]+`$/m.test(lockText), true, 'rollout approval lock must declare canonical approval record ID');
assert.equal(roadmapText.includes('### N.8 Rollout authorization approval lock'), true, 'roadmap must include Appendix N.8 rollout authorization lock policy');
assert.equal(rolloutSpecText.includes('`docs/specs/usr-rollout-approval-lock.md`'), true, 'rollout migration spec must reference rollout approval lock contract');
assert.equal(rolloutSpecText.includes('Gate C rollout authorization cannot be checked unless the lock state is `approved`'), true, 'rollout migration spec must gate Gate C authorization on rollout lock approval');

const requiredRoles = ['usr-architecture', 'usr-conformance', 'usr-operations'];
const roleDecisions = new Map();
for (const role of requiredRoles) {
  const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowPattern = new RegExp(
    '^\\| `' + escapedRole + '` \\| (approved|pending|rejected) \\| (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z) \\|$',
    'm'
  );
  const rowMatch = lockText.match(rowPattern);
  assert.notEqual(rowMatch, null, `rollout approval lock missing role decision row: ${role}`);
  roleDecisions.set(role, rowMatch[1]);
}

const readinessReportApproved = extractChecklistState('Readiness report approved.');
const testRolloutAuthorized = extractChecklistState('Test rollout authorized.');
const conformanceRolloutAuthorized = extractChecklistState('conformance rollout authorized.');

if (readinessReportApproved === 'checked' || testRolloutAuthorized === 'checked' || conformanceRolloutAuthorized === 'checked') {
  assert.equal(approvalState, 'approved', 'rollout approval lock must be approved when readiness/authorization checklist items are checked');
  for (const role of requiredRoles) {
    assert.equal(roleDecisions.get(role), 'approved', `role decision must be approved for checked readiness/authorization state: ${role}`);
  }
}

if (approvalState === 'pending') {
  assert.equal(testRolloutAuthorized, 'unchecked', 'Test rollout authorized must remain unchecked while rollout lock is pending');
  assert.equal(conformanceRolloutAuthorized, 'unchecked', 'Gate C conformance rollout authorized must remain unchecked while rollout lock is pending');
}

for (const testId of [
  'lang/contracts/usr-rollout-migration-policy-validation',
  'lang/contracts/usr-rollout-gate-validation',
  'lang/contracts/usr-gate-c-authorization-chain-validation',
  'lang/contracts/usr-rollout-approval-lock-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing rollout-approval governance validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing rollout-approval governance validator: ${testId}`);
}

console.log('usr rollout approval lock validation checks passed');
