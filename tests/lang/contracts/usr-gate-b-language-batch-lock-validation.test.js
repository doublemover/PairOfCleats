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
const diagnosticsSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-diagnostics-reasoncodes.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const gateB1Section = extractSection(roadmapText, '### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const appendixCSection = extractSection(roadmapText, '## Appendix C - Exhaustive Per-Language Task Packs by Batch', '## Appendix D - Exhaustive Framework Profile Task Packs (C4)');
const phase8ExitSection = extractSection(roadmapText, '### 8.4 Exit criteria', '## Phase 9 - Pre-Test Readiness and Batch Sign-Off');
const phase11ExitSection = extractSection(roadmapText, '### 11.3 Exit criteria', '## Phase 12 - Deep Conformance C2/C3');

const allTaskPacksCompleted = checklistLineState(gateB1Section, 'all language task packs in batch completed.');
const c0c1ChecksPass = checklistLineState(gateB1Section, 'C0/C1 checks pass for batch languages.');
const determinismChecksPass = checklistLineState(gateB1Section, 'determinism checks pass for batch languages.');
const knownDegradationsRecorded = checklistLineState(gateB1Section, 'known degradations recorded with diagnostic codes.');
const severityAlignmentChecksPass = checklistLineState(gateB1Section, 'diagnostic severity/code alignment checks pass for language batch fixtures.');

if (allTaskPacksCompleted === 'checked') {
  assert.equal(hasUnchecked(appendixCSection), false, 'Gate B1-B7 task-pack completion cannot be checked while Appendix C contains unchecked checklist items');
}

if (c0c1ChecksPass === 'checked') {
  const phase11Line = checklistLineState(phase11ExitSection, 'All languages pass required C0/C1 checks.');
  assert.equal(phase11Line, 'checked', 'Gate B1-B7 C0/C1 line cannot be checked before Phase 11 exit criterion is checked');
}

if (determinismChecksPass === 'checked') {
  const phase8Line = checklistLineState(phase8ExitSection, 'Determinism checks pass under repeated runs.');
  assert.equal(phase8Line, 'checked', 'Gate B1-B7 determinism line cannot be checked before Phase 8 determinism exit criterion is checked');
}

if (knownDegradationsRecorded === 'checked' || severityAlignmentChecksPass === 'checked') {
  assert.equal(fs.existsSync(diagnosticsSpecPath), true, 'diagnostic lock requires diagnostics/reason-codes contract document');
  assertTestsPresent(
    [
      'lang/contracts/usr-contract-enforcement',
      'lang/contracts/usr-diagnostic-remediation-routing-validation',
      'lang/contracts/usr-canonical-example-validation'
    ],
    'diagnostic lock validator',
    ciOrderText,
    ciLiteOrderText
  );
}

for (const fragment of [
  'Gate B1-B7 language-batch completion lock requirements:',
  '`all language task packs in batch completed.` cannot be checked while Appendix C contains unchecked language task-pack items.',
  '`determinism checks pass for batch languages.` cannot be checked unless Phase 8 exit criterion `Determinism checks pass under repeated runs.` is checked.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing Gate B lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.11 Gate B1-B7 language-batch completion lock'), true, 'roadmap must include Appendix N.11 Gate B1-B7 completion lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-gate-b-language-batch-lock-validation',
    'lang/contracts/usr-phase8-exit-lock-validation',
    'lang/contracts/usr-phase9-readiness-audit-lock-validation',
    'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
    'lang/contracts/usr-gate-c-prereq-lock-validation'
  ],
  'Gate B lock validator coverage',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr Gate B1-B7 language-batch lock validation checks passed');
