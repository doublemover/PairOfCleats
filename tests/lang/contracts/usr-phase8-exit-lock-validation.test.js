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

const phase84Section = extractSection(roadmapText, '### 8.4 Exit criteria', '---\n\n## Phase 9 - Pre-Test Readiness and Batch Sign-Off');
const gateBSection = extractSection(roadmapText, '### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const gateCSection = extractSection(roadmapText, '### Gate C (test rollout)', '---\n\n## Appendix C - Exhaustive Per-Language Task Packs by Batch');

const determinismLine = checklistLineState(phase84Section, 'Determinism checks pass under repeated runs.');
const capLine = checklistLineState(phase84Section, 'Cap-trigger tests pass with expected diagnostics.');
const runtimeThresholdsLine = checklistLineState(phase84Section, 'Runtime thresholds meet target envelopes.');
const blockingSloLine = checklistLineState(phase84Section, 'Blocking SLO budgets are met for required lanes.');

const gateBDeterminism = checklistLineState(gateBSection, 'determinism checks pass for batch languages.');
const gateCBlockingSlo = checklistLineState(gateCSection, 'blocking SLO budgets are green for required lanes.');

if (determinismLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-phase8-hardening-readiness-validation',
      'lang/contracts/usr-batch-slo-threshold-coverage-validation'
    ],
    'phase 8.4 determinism lock'
  );
}

if (capLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-phase8-hardening-readiness-validation',
      'lang/contracts/usr-failure-injection-validation',
      'lang/contracts/usr-failure-mode-suite-validation'
    ],
    'phase 8.4 cap-trigger lock'
  );
}

if (runtimeThresholdsLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-batch-slo-threshold-coverage-validation',
      'lang/contracts/usr-observability-rollup-validation',
      'lang/contracts/usr-benchmark-policy-validation'
    ],
    'phase 8.4 runtime-threshold lock'
  );
}

if (blockingSloLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-batch-slo-threshold-coverage-validation',
      'lang/contracts/usr-observability-rollup-validation'
    ],
    'phase 8.4 blocking-SLO lock'
  );
}

if ((determinismLine === 'unchecked' || capLine === 'unchecked' || runtimeThresholdsLine === 'unchecked' || blockingSloLine === 'unchecked') && gateBDeterminism === 'checked') {
  assert.fail('Gate B determinism checklist line must be reopened if Phase 8.4 hardening exit lines regress to unchecked');
}

if ((runtimeThresholdsLine === 'unchecked' || blockingSloLine === 'unchecked') && gateCBlockingSlo === 'checked') {
  assert.fail('Gate C blocking-SLO checklist line must be reopened if Phase 8.4 threshold/SLO exit lines regress to unchecked');
}

for (const fragment of [
  'Phase 8.4 hardening exit-integrity lock requirements:',
  '`Determinism checks pass under repeated runs.` cannot be checked unless phase-8 hardening/determinism validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Cap-trigger tests pass with expected diagnostics.` cannot be checked unless cap-trigger diagnostics/failure validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Runtime thresholds meet target envelopes.` and `Blocking SLO budgets are met for required lanes.` cannot be checked unless SLO threshold and observability validators remain present in `ci` and `ci-lite` lane manifests.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-8.4 hardening-exit lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.24 Phase 8.4 hardening exit-integrity lock'), true, 'roadmap must include Appendix N.24 phase-8.4 hardening exit lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase8-exit-lock-validation',
    'lang/contracts/usr-phase8-hardening-readiness-validation',
    'lang/contracts/usr-gate-b-language-batch-lock-validation',
    'lang/contracts/usr-observability-rollup-validation',
    'lang/contracts/usr-batch-slo-threshold-coverage-validation'
  ],
  'phase 8.4 hardening-exit lock umbrella'
);

console.log('usr phase 8.4 hardening exit lock validation checks passed');
