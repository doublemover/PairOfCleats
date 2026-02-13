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
  '### Phase-to-CI gate mapping',
  'Rollout authorization lock requirements:',
  'Gate C rollout authorization cannot be checked unless the lock state is `approved`',
  'Phase A | `lang/contracts/usr-contract-enforcement`',
  'Phase B | `backcompat/backcompat-matrix-validation`',
  'Phase C | `lang/contracts/usr-implementation-readiness-validation`',
  'Phase D | `lang/contracts/usr-c0-baseline-validation`',
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
  '### F.2 Backward compatibility and deprecation (USR section 27)',
  '### N.8 Rollout authorization approval lock',
  '### N.9 Appendix F.1 phase-promotion lock',
  '### N.10 Phase 9 readiness authorization lock',
  '### N.11 Gate B1-B7 language-batch completion lock',
  '### N.12 Phase 9.1 readiness-audit completion lock',
  '### N.13 Gate C conformance-authorization chain lock',
  '### N.14 Appendix F.1 phase-evidence lock',
  '### N.15 Phase 9.2 go/no-go decision lock',
  '### N.16 Gate C evidence-completeness lock',
  '### N.17 Phase 15 exit-completion lock',
  '### N.18 Phase 15.2 reporting-integrity lock',
  '### N.19 Phase 15.1 CI gate-integrity lock',
  '### N.20 Phase 15.3 maintenance-integrity lock',
  '### N.21 Phase 14.3 integration/failure exit lock',
  '### N.22 Phase 11-13 conformance exit-integrity lock',
  '### N.23 Phase 10.3 harness exit-integrity lock',
  '### N.24 Phase 8.4 hardening exit-integrity lock',
  '### N.25 Phase 7.3 fixture/golden exit-integrity lock',
  '### N.26 Phase 6.6 semantics exit-integrity lock'
];
for (const anchor of requiredRoadmapAnchors) {
  assert.equal(roadmapText.includes(anchor), true, `roadmap missing rollout/deprecation anchor: ${anchor}`);
}

const requiredCiTestsByPhase = {
  phaseA: [
    'lang/contracts/usr-contract-enforcement',
    'shared/contracts/usr-schema-validators',
    'shared/contracts/usr-matrix-validators',
    'decomposed-drift/decomposed-drift-validation'
  ],
  phaseB: [
    'backcompat/backcompat-matrix-validation',
    'lang/contracts/usr-rollout-migration-policy-validation',
    'lang/contracts/usr-rollout-gate-validation'
  ],
  phaseC: [
    'lang/contracts/usr-implementation-readiness-validation',
    'lang/contracts/usr-observability-rollup-validation',
    'lang/contracts/usr-security-gate-validation'
  ],
  phaseD: [
    'lang/contracts/usr-c0-baseline-validation',
    'lang/contracts/usr-c1-baseline-validation',
    'lang/contracts/usr-c2-baseline-validation',
    'lang/contracts/usr-c3-baseline-validation',
    'lang/contracts/usr-c4-baseline-validation'
  ]
};

const ciOnlyTests = new Set([
  'backcompat/backcompat-matrix-validation',
  'decomposed-drift/decomposed-drift-validation'
]);

for (const [phaseId, testIds] of Object.entries(requiredCiTestsByPhase)) {
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${phaseId} rollout gate test: ${testId}`);
    if (!ciOnlyTests.has(testId)) {
      assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${phaseId} rollout gate test: ${testId}`);
    }
  }
}

const requiredCrossPhaseTests = [
  'lang/contracts/usr-rollout-approval-lock-validation',
  'lang/contracts/usr-rollout-f1-checklist-validation',
  'lang/contracts/usr-rollout-evidence-lock-validation',
  'lang/contracts/usr-gonogo-decision-lock-validation',
  'lang/contracts/usr-readiness-authorization-lock-validation',
  'lang/contracts/usr-readiness-audit-lock-validation',
  'lang/contracts/usr-gate-b-language-batch-lock-validation',
  'lang/contracts/usr-gate-c-evidence-completeness-lock-validation',
  'lang/contracts/usr-gate-c-authorization-chain-validation',
  'lang/contracts/usr-semantics-exit-lock-validation',
  'lang/contracts/usr-fixture-golden-exit-lock-validation',
  'lang/contracts/usr-hardening-exit-lock-validation',
  'lang/contracts/usr-harness-exit-lock-validation',
  'lang/contracts/usr-conformance-exit-lock-validation',
  'lang/contracts/usr-integration-failure-exit-lock-validation',
  'lang/contracts/usr-ci-gate-lock-validation',
  'lang/contracts/usr-reporting-lock-validation',
  'lang/contracts/usr-maintenance-lock-validation',
  'lang/contracts/usr-rollout-exit-lock-validation',
  'lang/contracts/usr-governance-lock-suite-validation',
  'lang/contracts/usr-archival-deprecation-policy-validation',
  'lang/contracts/usr-pr-template-policy-validation'
];

for (const testId of requiredCrossPhaseTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing rollout/deprecation governance test: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing rollout/deprecation governance test: ${testId}`);
}

console.log('usr rollout phase-gate validation checks passed');
