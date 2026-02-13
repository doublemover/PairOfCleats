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


const phase103Section = extractSection(roadmapText, '### 10.3 Exit criteria', '---\n\n## Phase 11 - Baseline Conformance C0/C1');
const phase113Section = extractSection(roadmapText, '### 11.3 Exit criteria', '## Phase 12 - Deep Conformance C2/C3');
const phase123Section = extractSection(roadmapText, '### 12.3 Exit criteria', '## Phase 13 - Framework Conformance C4');
const phase132Section = extractSection(roadmapText, '### 13.2 Exit criteria', '## Phase 14 - Integration and Failure-Mode Enforcement');

const harnessCoverageLine = checklistLineState(phase103Section, 'Harness can execute matrix-driven checks for all languages/frameworks.');
const shardDeterminismLine = checklistLineState(phase103Section, 'Lane ordering and sharding are deterministic.');

const phase11Exit = checklistLineState(phase113Section, 'All languages pass required C0/C1 checks.');
const phase12Exit = checklistLineState(phase123Section, 'Required C2/C3 profile checks pass.');
const phase13Exit = checklistLineState(phase132Section, 'All required framework profiles pass C4 checks.');

if (harnessCoverageLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-matrix-driven-harness-validation',
      'lang/contracts/usr-harness-lane-materialization-validation'
    ],
    'phase 10.3 harness-coverage lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (shardDeterminismLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-language-batch-shards-validation',
      'lang/contracts/usr-harness-lane-materialization-validation'
    ],
    'phase 10.3 shard-determinism lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if ((harnessCoverageLine === 'unchecked' || shardDeterminismLine === 'unchecked') && (phase11Exit === 'checked' || phase12Exit === 'checked' || phase13Exit === 'checked')) {
  assert.fail('phase 11.3/12.3/13.2 conformance exits must be reopened if phase 10.3 harness exit lines regress to unchecked');
}

for (const fragment of [
  'Phase 10.3 harness exit-integrity lock requirements:',
  '`Harness can execute matrix-driven checks for all languages/frameworks.` cannot be checked unless matrix-driven harness and lane materialization validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Lane ordering and sharding are deterministic.` cannot be checked unless shard partition and lane materialization validators remain present in `ci` and `ci-lite` lane manifests.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-10.3 harness-exit lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.23 Phase 10.3 harness exit-integrity lock'), true, 'roadmap must include Appendix N.23 phase-10.3 harness exit lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-harness-exit-lock-validation',
    'lang/contracts/usr-conformance-exit-lock-validation',
    'lang/contracts/usr-matrix-driven-harness-validation',
    'lang/contracts/usr-language-batch-shards-validation',
    'lang/contracts/usr-harness-lane-materialization-validation'
  ],
  'phase 10.3 harness-exit lock umbrella',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 10.3 harness exit lock validation checks passed');
