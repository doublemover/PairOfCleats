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

const assertTestsPresent = (testIds, context) => {
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${context} dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${context} dependency: ${testId}`);
  }
};

const phase73Section = extractSection(roadmapText, '### 7.3 Exit criteria', '---\n\n## Phase 8 - Determinism, Caps, and Performance Hardening');
const phase84Section = extractSection(roadmapText, '### 8.4 Exit criteria', '---\n\n## Phase 9 - Pre-Test Readiness and Batch Sign-Off');
const phase91Section = extractSection(roadmapText, '### 9.1 Readiness audit', '### 9.2 Go/No-Go decision');

const fixtureCoverageExit = checklistLineState(phase73Section, 'Every language and framework has exhaustive fixture coverage evidence.');
const goldenDeterminismExit = checklistLineState(phase73Section, 'Golden diffs are deterministic on rerun.');

const phase8Determinism = checklistLineState(phase84Section, 'Determinism checks pass under repeated runs.');
const phase9FixtureEvidence = checklistLineState(phase91Section, 'Validate fixture-governance validation evidence for blocking fixture families is complete.');

if (fixtureCoverageExit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-fixture-governance-validation',
      'lang/contracts/usr-fixture-governance-coverage-floor-validation',
      'lang/contracts/usr-fixture-golden-readiness-validation'
    ],
    'phase 7.3 fixture-coverage lock'
  );
}

if (goldenDeterminismExit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-fixture-golden-readiness-validation',
      'lang/contracts/usr-phase8-hardening-readiness-validation'
    ],
    'phase 7.3 golden-determinism lock'
  );
}

if (goldenDeterminismExit === 'unchecked' && phase8Determinism === 'checked') {
  assert.fail('phase 8.4 determinism line must be reopened if phase 7.3 golden-determinism exit line regresses to unchecked');
}

if (fixtureCoverageExit === 'unchecked' && phase9FixtureEvidence === 'checked') {
  assert.fail('phase 9.1 fixture-evidence checklist line must be reopened if phase 7.3 fixture-coverage exit line regresses to unchecked');
}

for (const fragment of [
  'Phase 7.3 fixture/golden exit-integrity lock requirements:',
  '`Every language and framework has exhaustive fixture coverage evidence.` cannot be checked unless fixture governance/coverage-floor/golden validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Golden diffs are deterministic on rerun.` cannot be checked unless fixture-golden and phase-8 determinism validators remain present in `ci` and `ci-lite` lane manifests.',
  'If any Phase 7.3 fixture/golden exit line regresses to unchecked, Phase 8.4 determinism and Phase 9.1 fixture-evidence checklist lines must be reopened.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-7.3 fixture/golden lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.25 Phase 7.3 fixture/golden exit-integrity lock'), true, 'roadmap must include Appendix N.25 phase-7.3 fixture/golden exit lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase7-exit-lock-validation',
    'lang/contracts/usr-phase8-exit-lock-validation',
    'lang/contracts/usr-fixture-governance-coverage-floor-validation',
    'lang/contracts/usr-fixture-golden-readiness-validation',
    'lang/contracts/usr-phase8-hardening-readiness-validation'
  ],
  'phase 7.3 fixture/golden lock umbrella'
);

console.log('usr phase 7.3 fixture/golden exit lock validation checks passed');
