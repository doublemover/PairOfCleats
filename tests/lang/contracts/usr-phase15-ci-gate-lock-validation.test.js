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

const hasUnchecked = (section) => /- \[ \] /.test(section);

const assertTestsPresent = (testIds, context) => {
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${context} dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${context} dependency: ${testId}`);
  }
};

const phase151Section = extractSection(roadmapText, '### 15.1 CI gates', '### 15.2 Reporting');
const phase154Section = extractSection(roadmapText, '### 15.4 Exit criteria', '---\n\n## Appendix A - USR Spec to Roadmap Traceability');
const phase15Exit = checklistLineState(phase154Section, 'CI and maintenance controls are stable for ongoing development.');

const ciGateLine = checklistLineState(phase151Section, 'Enforce Gate A, B1-B8, and C gates in CI.');
const conformanceLine = checklistLineState(phase151Section, 'Enforce C0-C4 conformance lane required checks.');
const backcompatLine = checklistLineState(phase151Section, 'Enforce section 36 strict scenario blocking behavior and non-strict warning budgets.');
const observabilityLine = checklistLineState(phase151Section, 'Enforce section 41 SLO budget blocking policies and alert escalation behavior.');
const securityLine = checklistLineState(phase151Section, 'Enforce section 42 security gate fail-closed blocking policies.');
const runtimeConfigLine = checklistLineState(phase151Section, 'Enforce section 43 runtime configuration strict-validation and disallowed-flag conflict policies.');
const failureInjectionLine = checklistLineState(phase151Section, 'Enforce section 44 failure-injection blocking scenario pass requirements.');
const fixtureGovernanceLine = checklistLineState(phase151Section, 'Enforce section 45 fixture-governance blocking mutation policies and ownership checks.');
const benchmarkLine = checklistLineState(phase151Section, 'Enforce section 46 benchmark methodology and regression threshold policies.');
const threatModelLine = checklistLineState(phase151Section, 'Enforce section 47 threat-model critical-coverage and abuse-case execution policies.');
const waiverLine = checklistLineState(phase151Section, 'Enforce section 48 waiver expiry and approver-governance policies.');

if (ciGateLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-gate-a-registry-readiness-validation',
      'lang/contracts/usr-gate-b-language-batch-lock-validation',
      'lang/contracts/usr-gate-c-prereq-lock-validation',
      'lang/contracts/usr-gate-c-evidence-completeness-lock-validation',
      'lang/contracts/usr-gate-c-authorization-chain-validation',
      'lang/contracts/usr-rollout-phase-gate-validation',
      'lang/contracts/usr-rollout-migration-policy-validation'
    ],
    'phase 15.1 gate-A/B/C lock'
  );
}

if (conformanceLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-c0-baseline-validation',
      'lang/contracts/usr-c1-baseline-validation',
      'lang/contracts/usr-c2-baseline-validation',
      'lang/contracts/usr-c3-baseline-validation',
      'lang/contracts/usr-c4-baseline-validation',
      'lang/contracts/usr-conformance-phase-exit-lock-validation'
    ],
    'phase 15.1 C0-C4 lock'
  );
}

if (backcompatLine === 'checked') {
  assertTestsPresent(['backcompat/backcompat-matrix-validation'], 'phase 15.1 section-36 lock');
}

if (observabilityLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-observability-rollup-validation',
      'lang/contracts/usr-batch-slo-threshold-coverage-validation',
      'lang/contracts/usr-phase8-exit-lock-validation'
    ],
    'phase 15.1 section-41 lock'
  );
}

if (securityLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-security-gate-validation',
      'lang/contracts/usr-phase6-exit-lock-validation'
    ],
    'phase 15.1 section-42 lock'
  );
}

if (runtimeConfigLine === 'checked') {
  assertTestsPresent(['lang/contracts/usr-runtime-config-feature-flag-validation'], 'phase 15.1 section-43 lock');
}

if (failureInjectionLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-failure-injection-validation',
      'lang/contracts/usr-failure-injection-recovery-threshold-validation',
      'lang/contracts/usr-failure-mode-suite-validation'
    ],
    'phase 15.1 section-44 lock'
  );
}

if (fixtureGovernanceLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-fixture-governance-validation',
      'lang/contracts/usr-fixture-mutation-policy-coverage-validation',
      'lang/contracts/usr-fixture-governance-coverage-floor-validation',
      'lang/contracts/usr-phase7-exit-lock-validation'
    ],
    'phase 15.1 section-45 lock'
  );
}

if (benchmarkLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-benchmark-policy-validation',
      'lang/contracts/usr-cross-batch-regression-resolution-validation'
    ],
    'phase 15.1 section-46 lock'
  );
}

if (threatModelLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-threat-model-coverage-validation',
      'lang/contracts/usr-phase6-exit-lock-validation'
    ],
    'phase 15.1 section-47 lock'
  );
}

if (waiverLine === 'checked') {
  assertTestsPresent(['lang/contracts/usr-waiver-policy-validation'], 'phase 15.1 section-48 lock');
}

if (hasUnchecked(phase151Section) && phase15Exit === 'checked') {
  assert.fail('phase 15 exit must be reopened when phase 15.1 CI-gate prerequisites are not fully checked');
}

for (const fragment of [
  'Phase 15.1 CI gate-integrity lock requirements:',
  '`Enforce Gate A, B1-B8, and C gates in CI.` cannot be checked unless Gate A/B/C lock validators remain present in required CI lanes.',
  '`Enforce C0-C4 conformance lane required checks.` cannot be checked unless C0/C1/C2/C3/C4 baseline validators are present in required CI lanes.',
  '`Enforce section 36 strict scenario blocking behavior and non-strict warning budgets.` cannot be checked unless `backcompat/backcompat-matrix-validation` remains present in required CI lanes.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-15.1 CI-gate lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.19 Phase 15.1 CI gate-integrity lock'), true, 'roadmap must include Appendix N.19 phase-15.1 CI-gate lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase15-ci-gate-lock-validation',
    'lang/contracts/usr-conformance-phase-exit-lock-validation',
    'lang/contracts/usr-phase15-reporting-lock-validation',
    'lang/contracts/usr-phase15-exit-lock-validation',
    'lang/contracts/usr-rollout-phase-gate-validation',
    'lang/contracts/usr-rollout-migration-policy-validation'
  ],
  'phase 15.1 CI-gate lock umbrella'
);

console.log('usr phase 15.1 CI gate lock validation checks passed');
