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

const phase141Section = extractSection(roadmapText, '### 14.1 Mixed-repo integration', '### 14.2 Failure-mode validation');
const phase142Section = extractSection(roadmapText, '### 14.2 Failure-mode validation', '### 14.3 Exit criteria');
const phase143Section = extractSection(roadmapText, '### 14.3 Exit criteria', '---\n\n## Phase 15 - CI Gates, Reporting, and Maintenance Operations');

const phase14Exit = checklistLineState(phase143Section, 'Integration and failure-mode suites pass.');

if (phase14Exit === 'checked') {
  assert.equal(hasUnchecked(phase141Section), false, 'phase 14.3 exit cannot be checked while section 14.1 has unchecked items');
  assert.equal(hasUnchecked(phase142Section), false, 'phase 14.3 exit cannot be checked while section 14.2 has unchecked items');

  assertTestsPresent(
    [
      'lang/contracts/usr-mixed-repo-integration-validation',
      'lang/contracts/usr-failure-injection-validation',
      'lang/contracts/usr-failure-injection-recovery-threshold-validation',
      'lang/contracts/usr-failure-mode-suite-validation',
      'lang/contracts/usr-security-gate-validation'
    ],
    'phase 14.3 integration/failure exit lock'
  );
}

if ((hasUnchecked(phase141Section) || hasUnchecked(phase142Section)) && phase14Exit === 'checked') {
  assert.fail('phase 14.3 exit must be reopened when phase 14.1/14.2 prerequisites are not fully checked');
}

for (const fragment of [
  'Phase 14.3 integration/failure exit lock requirements:',
  '`Integration and failure-mode suites pass.` cannot be checked unless every checklist line in sections 14.1 and 14.2 is checked.',
  'Phase 14.3 exit cannot be checked unless mixed-repo integration, failure-injection, failure-mode-suite, and security-gate validators remain present in `ci` and `ci-lite` lane manifests.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-14.3 integration/failure lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.21 Phase 14.3 integration/failure exit lock'), true, 'roadmap must include Appendix N.21 phase-14.3 integration/failure lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase14-exit-lock-validation',
    'lang/contracts/usr-mixed-repo-integration-validation',
    'lang/contracts/usr-failure-mode-suite-validation',
    'lang/contracts/usr-security-gate-validation',
    'lang/contracts/usr-rollout-migration-policy-validation'
  ],
  'phase 14.3 integration/failure lock umbrella'
);

console.log('usr phase 14.3 integration/failure exit lock validation checks passed');
