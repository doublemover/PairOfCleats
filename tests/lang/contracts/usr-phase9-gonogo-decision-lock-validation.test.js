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
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
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

const phase92Section = extractSection(roadmapText, '### 9.2 Go/No-Go decision', '### 9.3 Exit criteria');
const phase93Section = extractSection(roadmapText, '### 9.3 Exit criteria', '## Phase 10 - Harness and Lane Materialization');
const phase11ExitSection = extractSection(roadmapText, '### 11.3 Exit criteria', '## Phase 12 - Deep Conformance C2/C3');
const phase12ExitSection = extractSection(roadmapText, '### 12.3 Exit criteria', '## Phase 13 - Framework Conformance C4');
const phase13ExitSection = extractSection(roadmapText, '### 13.2 Exit criteria', '## Phase 14 - Integration and Failure-Mode Enforcement');

const blockTestRollout = checklistLineState(phase92Section, 'Block test rollout if any language lacks C0/C1 readiness.');
const blockDeepConformance = checklistLineState(phase92Section, 'Block deep conformance if C2/C3 prerequisites are missing.');
const blockFrameworkConformance = checklistLineState(phase92Section, 'Block framework conformance if C4 profile prerequisites are missing.');

const readinessReportApproved = checklistLineState(phase93Section, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase93Section, 'Test rollout authorized.');

if (blockTestRollout === 'checked') {
  assert.equal(checklistLineState(phase11ExitSection, 'All languages pass required C0/C1 checks.'), 'checked', 'phase 9.2 C0/C1 go/no-go lock requires Phase 11.3 exit criterion to be checked');
  for (const testId of [
    'lang/contracts/usr-c0-baseline-validation',
    'lang/contracts/usr-c1-baseline-validation'
  ]) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing C0/C1 go/no-go lock validator dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing C0/C1 go/no-go lock validator dependency: ${testId}`);
  }
}

if (blockDeepConformance === 'checked') {
  assert.equal(checklistLineState(phase12ExitSection, 'Required C2/C3 profile checks pass.'), 'checked', 'phase 9.2 C2/C3 go/no-go lock requires Phase 12.3 exit criterion to be checked');
  for (const testId of [
    'lang/contracts/usr-c2-baseline-validation',
    'lang/contracts/usr-c3-baseline-validation'
  ]) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing C2/C3 go/no-go lock validator dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing C2/C3 go/no-go lock validator dependency: ${testId}`);
  }
}

if (blockFrameworkConformance === 'checked') {
  assert.equal(checklistLineState(phase13ExitSection, 'All required framework profiles pass C4 checks.'), 'checked', 'phase 9.2 C4 go/no-go lock requires Phase 13.2 exit criterion to be checked');
  assert.equal(ciOrderText.includes('lang/contracts/usr-c4-baseline-validation'), true, 'ci order missing C4 go/no-go lock validator dependency: lang/contracts/usr-c4-baseline-validation');
  assert.equal(ciLiteOrderText.includes('lang/contracts/usr-c4-baseline-validation'), true, 'ci-lite order missing C4 go/no-go lock validator dependency: lang/contracts/usr-c4-baseline-validation');
}

if ((blockTestRollout === 'unchecked' || blockDeepConformance === 'unchecked' || blockFrameworkConformance === 'unchecked') && (readinessReportApproved === 'checked' || testRolloutAuthorized === 'checked')) {
  assert.fail('phase 9.3 readiness authorization lines must be reopened if Phase 9.2 go/no-go lock lines regress to unchecked');
}

for (const fragment of [
  'Phase 9.2 go/no-go decision lock requirements:',
  '`Block test rollout if any language lacks C0/C1 readiness.` cannot be checked unless Phase 11.3 exit criterion is checked and C0/C1 baseline conformance lane validators remain in required CI lanes.',
  '`Block framework conformance if C4 profile prerequisites are missing.` cannot be checked unless Phase 13.2 exit criterion is checked and C4 baseline conformance lane validators remain in required CI lanes.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-9.2 go/no-go lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.15 Phase 9.2 go/no-go decision lock'), true, 'roadmap must include Appendix N.15 phase-9.2 go/no-go lock policy');

for (const testId of [
  'lang/contracts/usr-phase9-gonogo-decision-lock-validation',
  'lang/contracts/usr-conformance-phase-exit-lock-validation',
  'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
  'lang/contracts/usr-rollout-phase-gate-validation',
  'lang/contracts/usr-rollout-migration-policy-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing phase-9.2 go/no-go lock validator coverage: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing phase-9.2 go/no-go lock validator coverage: ${testId}`);
}

console.log('usr phase 9.2 go/no-go decision lock validation checks passed');
