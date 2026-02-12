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
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const phase91Section = extractSection(roadmapText, '### 9.1 Readiness audit', '### 9.2 Go/No-Go decision');
const phase92Section = extractSection(roadmapText, '### 9.2 Go/No-Go decision', '### 9.3 Exit criteria');
const phase93Section = extractSection(roadmapText, '### 9.3 Exit criteria', '## Phase 10 - Harness and Lane Materialization');
const gateB1Section = extractSection(roadmapText, '### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const gateB8Section = extractSection(roadmapText, '### Gate B8 (cross-batch integration)', '### Gate C (test rollout)');

const readinessReportApproved = checklistLineState(phase93Section, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase93Section, 'Test rollout authorized.');

if (readinessReportApproved === 'checked') {
  assert.equal(hasUnchecked(phase91Section), false, 'Readiness report approved cannot be checked while Phase 9.1 contains unchecked items');
  assert.equal(hasUnchecked(phase92Section), false, 'Readiness report approved cannot be checked while Phase 9.2 contains unchecked items');
}

if (testRolloutAuthorized === 'checked') {
  assert.equal(readinessReportApproved, 'checked', 'Test rollout authorized requires Readiness report approved to be checked first');
  assert.equal(hasUnchecked(gateB1Section), false, 'Test rollout authorized cannot be checked while Gate B1-B7 contains unchecked items');
}

if (hasUnchecked(gateB8Section)) {
  assert.equal(readinessReportApproved, 'unchecked', 'Readiness report approved must be reopened if Gate B8 regresses to unchecked');
  assert.equal(testRolloutAuthorized, 'unchecked', 'Test rollout authorized must be reopened if Gate B8 regresses to unchecked');
}

for (const fragment of [
  'Phase 9 readiness authorization lock requirements:',
  '`Readiness report approved.` cannot be checked while any item in Phase 9.1 (`Readiness audit`) or Phase 9.2 (`Go/No-Go decision`) is unchecked.',
  '`Test rollout authorized.` cannot be checked unless `Readiness report approved.` is checked and Gate B1-B7 checklist has no unchecked items.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-9 readiness lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.10 Phase 9 readiness authorization lock'), true, 'roadmap must include Appendix N.10 phase-9 readiness lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase9-gonogo-decision-lock-validation',
    'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
    'lang/contracts/usr-phase9-readiness-audit-lock-validation',
    'lang/contracts/usr-rollout-f1-checklist-validation',
    'lang/contracts/usr-gate-b-language-batch-lock-validation',
    'lang/contracts/usr-gate-c-evidence-completeness-lock-validation',
    'lang/contracts/usr-gate-c-authorization-chain-validation',
    'lang/contracts/usr-rollout-approval-lock-validation',
    'lang/contracts/usr-gate-c-prereq-lock-validation'
  ],
  'phase-9 readiness authorization lock test',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 9 readiness authorization lock validation checks passed');
