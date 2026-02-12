#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestsPresent, checklistLineState, extractSection } from './usr-lock-test-utils.js';

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
const conformanceRolloutAuthorized = checklistLineState(gateCSection, 'conformance rollout authorized.');
const readinessReportApproved = checklistLineState(phase9ExitSection, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase9ExitSection, 'Test rollout authorized.');
const phaseD = checklistLineState(f1Section, 'Complete Phase D full conformance enforcement.');

const requiredGateCEvidenceLines = [
  'backward-compat matrix strict scenarios are green in CI.',
  'decomposed contract drift checks are green in CI.',
  'implementation-readiness evidence validators are green for promotion target phase.',
  'blocking SLO budgets are green for required lanes.',
  'strict security gates are green in CI.',
  'strict blocking failure-injection scenarios are green in CI.',
  'fixture-governance validation is green for blocking fixture families.',
  'benchmark regression policy is green for blocking benchmark rows.',
  'threat-model critical coverage and abuse-case lanes are green.',
  'waiver expiry/breach enforcement checks are green.'
];

for (const line of requiredGateCEvidenceLines) {
  assert.notEqual(checklistLineState(gateCSection, line), undefined, `missing Gate C evidence line: ${line}`);
}

if (allPriorGatesPass === 'checked') {
  for (const line of requiredGateCEvidenceLines) {
    assert.equal(checklistLineState(gateCSection, line), 'checked', `Gate C all prior gates pass requires evidence line to be checked: ${line}`);
  }
}

const hasMissingEvidence = requiredGateCEvidenceLines.some((line) => checklistLineState(gateCSection, line) === 'unchecked');

if (allPriorGatesPass === 'unchecked') {
  assert.equal(conformanceRolloutAuthorized, 'unchecked', 'Gate C conformance rollout authorized must remain unchecked while all prior gates pass is unchecked');
  assert.equal(phaseD, 'unchecked', 'Appendix F.1 Phase D must remain unchecked while Gate C all prior gates pass is unchecked');
}

if (hasMissingEvidence) {
  assert.equal(readinessReportApproved, 'unchecked', 'Readiness report approved must remain unchecked while required Gate C evidence is unchecked');
  assert.equal(testRolloutAuthorized, 'unchecked', 'Test rollout authorized must remain unchecked while required Gate C evidence is unchecked');
  assert.equal(conformanceRolloutAuthorized, 'unchecked', 'Gate C conformance rollout authorized must remain unchecked while required Gate C evidence is unchecked');
}

for (const fragment of [
  'Gate C evidence-completeness lock requirements:',
  '`all prior gates pass.` cannot be checked unless every Gate C evidence line (backcompat, drift, implementation-readiness, SLO, security, failure-injection, fixture-governance, benchmark, threat-model, waiver) is checked.',
  'If `all prior gates pass.` regresses to unchecked, `conformance rollout authorized.` and Appendix F.1 `Complete Phase D full conformance enforcement.` must remain unchecked until Gate C evidence is restored.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing Gate C evidence lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.16 Gate C evidence-completeness lock'), true, 'roadmap must include Appendix N.16 Gate C evidence-completeness lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-gate-c-evidence-completeness-lock-validation',
    'lang/contracts/usr-gate-c-prereq-lock-validation',
    'lang/contracts/usr-gate-c-authorization-chain-validation',
    'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
    'lang/contracts/usr-rollout-phase-evidence-lock-validation'
  ],
  'Gate C evidence-completeness lock validator coverage',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr Gate C evidence-completeness lock validation checks passed');
