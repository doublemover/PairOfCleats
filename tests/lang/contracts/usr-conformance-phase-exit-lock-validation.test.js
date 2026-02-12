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


const phase92Section = extractSection(roadmapText, '### 9.2 Go/No-Go decision', '### 9.3 Exit criteria');
const phase113Section = extractSection(roadmapText, '### 11.3 Exit criteria', '## Phase 12 - Deep Conformance C2/C3');
const phase123Section = extractSection(roadmapText, '### 12.3 Exit criteria', '## Phase 13 - Framework Conformance C4');
const phase132Section = extractSection(roadmapText, '### 13.2 Exit criteria', '## Phase 14 - Integration and Failure-Mode Enforcement');

const phase11Exit = checklistLineState(phase113Section, 'All languages pass required C0/C1 checks.');
const phase12Exit = checklistLineState(phase123Section, 'Required C2/C3 profile checks pass.');
const phase13Exit = checklistLineState(phase132Section, 'All required framework profiles pass C4 checks.');

const blockC0C1 = checklistLineState(phase92Section, 'Block test rollout if any language lacks C0/C1 readiness.');
const blockC2C3 = checklistLineState(phase92Section, 'Block deep conformance if C2/C3 prerequisites are missing.');
const blockC4 = checklistLineState(phase92Section, 'Block framework conformance if C4 profile prerequisites are missing.');

if (phase11Exit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-c0-baseline-validation',
      'lang/contracts/usr-c1-baseline-validation'
    ],
    'phase 11.3 conformance-exit lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (phase12Exit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-c2-baseline-validation',
      'lang/contracts/usr-c3-baseline-validation'
    ],
    'phase 12.3 conformance-exit lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (phase13Exit === 'checked') {
  assertTestsPresent(
    ['lang/contracts/usr-c4-baseline-validation'],
    'phase 13.2 conformance-exit lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (phase11Exit === 'unchecked' && blockC0C1 === 'checked') {
  assert.fail('phase 9.2 C0/C1 go/no-go line must be reopened if phase 11.3 exit criterion regresses to unchecked');
}

if (phase12Exit === 'unchecked' && blockC2C3 === 'checked') {
  assert.fail('phase 9.2 C2/C3 go/no-go line must be reopened if phase 12.3 exit criterion regresses to unchecked');
}

if (phase13Exit === 'unchecked' && blockC4 === 'checked') {
  assert.fail('phase 9.2 C4 go/no-go line must be reopened if phase 13.2 exit criterion regresses to unchecked');
}

for (const fragment of [
  'Phase 11-13 conformance exit-integrity lock requirements:',
  '`All languages pass required C0/C1 checks.` cannot be checked unless C0/C1 baseline validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Required C2/C3 profile checks pass.` cannot be checked unless C2/C3 baseline validators remain present in `ci` and `ci-lite` lane manifests.',
  '`All required framework profiles pass C4 checks.` cannot be checked unless C4 baseline validators remain present in `ci` and `ci-lite` lane manifests.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing conformance phase-exit lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.22 Phase 11-13 conformance exit-integrity lock'), true, 'roadmap must include Appendix N.22 conformance phase-exit lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-conformance-phase-exit-lock-validation',
    'lang/contracts/usr-phase9-gonogo-decision-lock-validation',
    'lang/contracts/usr-c0-baseline-validation',
    'lang/contracts/usr-c1-baseline-validation',
    'lang/contracts/usr-c2-baseline-validation',
    'lang/contracts/usr-c3-baseline-validation',
    'lang/contracts/usr-c4-baseline-validation'
  ],
  'conformance phase-exit lock umbrella',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr conformance phase-exit lock validation checks passed');
