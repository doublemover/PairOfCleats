#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const rolloutSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-rollout-release-migration.md');
const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const requiredRolloutSpecFragments = [
  '### Roadmap phase mapping (A/B/C/D)',
  'Phase A (schema and registry readiness)',
  'Phase B (dual-write parity validation)',
  'Phase C (USR-backed production path validation)',
  'Phase D (full conformance enforcement)',
  'Rollout phases MUST be promoted in order A -> B -> C -> D',
  'Legacy-output retention requirements:',
  'legacy artifact outputs MUST remain emitted until Phase B parity and Phase C readiness evidence are both approved',
  '## Deprecation and archival protocol',
  'DEPRECATED header block',
  '`docs/archived/README.md`'
];

for (const fragment of requiredRolloutSpecFragments) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout spec missing required phase-gate/deprecation fragment: ${fragment}`);
}

const requiredRoadmapAnchors = [
  '### F.1 Rollout gates (USR section 26)',
  '### F.2 Backward compatibility and deprecation (USR section 27)'
];
for (const anchor of requiredRoadmapAnchors) {
  assert.equal(roadmapText.includes(anchor), true, `roadmap missing rollout/deprecation anchor: ${anchor}`);
}

const requiredCiTests = [
  'lang/contracts/usr-rollout-migration-policy-validation',
  'lang/contracts/usr-rollout-phase-gate-validation',
  'lang/contracts/usr-archival-deprecation-policy-validation',
  'lang/contracts/usr-pr-template-policy-validation',
  'lang/contracts/usr-implementation-readiness-validation',
  'backcompat/backcompat-matrix-validation'
];

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing rollout phase/deprecation validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing rollout phase/deprecation validator: ${testId}`);
}

console.log('usr rollout phase-gate validation checks passed');
