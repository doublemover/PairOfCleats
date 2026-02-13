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

const phase151Section = extractSection(roadmapText, '### 15.1 CI gates', '### 15.2 Reporting');
const phase152Section = extractSection(roadmapText, '### 15.2 Reporting', '### 15.3 Maintenance');
const phase153Section = extractSection(roadmapText, '### 15.3 Maintenance', '### 15.4 Exit criteria');
const phase154Section = extractSection(roadmapText, '### 15.4 Exit criteria', '---\n\n## Appendix A - USR Spec to Roadmap Traceability');

const phase15Exit = checklistLineState(phase154Section, 'CI and maintenance controls are stable for ongoing development.');

if (phase15Exit === 'checked') {
  assert.equal(hasUnchecked(phase151Section), false, 'phase 15 exit cannot be checked while section 15.1 has unchecked items');
  assert.equal(hasUnchecked(phase152Section), false, 'phase 15 exit cannot be checked while section 15.2 has unchecked items');
  assert.equal(hasUnchecked(phase153Section), false, 'phase 15 exit cannot be checked while section 15.3 has unchecked items');

  assertTestsPresent(
    [
      'lang/contracts/usr-maintenance-controls-stability',
      'lang/contracts/usr-rollout-migration-policy-validation',
      'lang/contracts/usr-rollout-gate-validation',
      'lang/contracts/usr-reporting-lock-validation',
      'lang/contracts/usr-rollout-exit-lock-validation',
      'lang/contracts/usr-report-schema-file-coverage-validation',
      'lang/contracts/usr-doc-schema-contract-validation'
    ],
    'phase-15 exit lock validator',
    ciOrderText,
    ciLiteOrderText
  );
}

if ((hasUnchecked(phase151Section) || hasUnchecked(phase152Section) || hasUnchecked(phase153Section)) && phase15Exit === 'checked') {
  assert.fail('phase 15 exit must be reopened when phase 15.1/15.2/15.3 prerequisites are not fully checked');
}

for (const fragment of [
  'Phase 15 exit-completion lock requirements:',
  'Phase 15.2 reporting-integrity lock requirements:',
  'Phase 15.3 maintenance-integrity lock requirements:',
  '`CI and maintenance controls are stable for ongoing development.` cannot be checked unless every checklist line in sections 15.1, 15.2, and 15.3 is checked.',
  'Phase 15 exit cannot be checked unless required maintenance/rollout/report-schema validators remain present in `ci` and `ci-lite` lane order manifests.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-15 exit lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.17 Phase 15 exit-completion lock'), true, 'roadmap must include Appendix N.17 phase-15 exit-completion lock policy');
assert.equal(roadmapText.includes('### N.18 Phase 15.2 reporting-integrity lock'), true, 'roadmap must include Appendix N.18 phase-15.2 reporting-integrity lock policy');
assert.equal(roadmapText.includes('### N.19 Phase 15.1 CI gate-integrity lock'), true, 'roadmap must include Appendix N.19 phase-15.1 CI-gate lock policy');
assert.equal(roadmapText.includes('### N.20 Phase 15.3 maintenance-integrity lock'), true, 'roadmap must include Appendix N.20 phase-15.3 maintenance lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-ci-gate-lock-validation',
    'lang/contracts/usr-reporting-lock-validation',
    'lang/contracts/usr-maintenance-lock-validation',
    'lang/contracts/usr-rollout-exit-lock-validation',
    'lang/contracts/usr-maintenance-controls-stability',
    'lang/contracts/usr-rollout-gate-validation',
    'lang/contracts/usr-rollout-migration-policy-validation'
  ],
  'phase-15 exit lock validator coverage',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 15 exit lock validation checks passed');
