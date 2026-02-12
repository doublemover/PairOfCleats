#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const guidePath = path.join(repoRoot, 'docs', 'guides', 'usr-contract-enforcement.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const guideText = fs.readFileSync(guidePath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const lockRows = [
  { anchor: '### N.7 Traceability approval lock', testId: 'lang/contracts/usr-traceability-approval-validation' },
  { anchor: '### N.8 Rollout authorization approval lock', testId: 'lang/contracts/usr-rollout-approval-lock-validation' },
  { anchor: '### N.9 Appendix F.1 phase-promotion lock', testId: 'lang/contracts/usr-rollout-f1-checklist-validation' },
  { anchor: '### N.10 Phase 9 readiness authorization lock', testId: 'lang/contracts/usr-phase9-readiness-authorization-lock-validation' },
  { anchor: '### N.11 Gate B1-B7 language-batch completion lock', testId: 'lang/contracts/usr-gate-b-language-batch-lock-validation' },
  { anchor: '### N.12 Phase 9.1 readiness-audit completion lock', testId: 'lang/contracts/usr-phase9-readiness-audit-lock-validation' },
  { anchor: '### N.13 Gate C conformance-authorization chain lock', testId: 'lang/contracts/usr-gate-c-authorization-chain-validation' },
  { anchor: '### N.14 Appendix F.1 phase-evidence lock', testId: 'lang/contracts/usr-rollout-phase-evidence-lock-validation' },
  { anchor: '### N.15 Phase 9.2 go/no-go decision lock', testId: 'lang/contracts/usr-phase9-gonogo-decision-lock-validation' },
  { anchor: '### N.16 Gate C evidence-completeness lock', testId: 'lang/contracts/usr-gate-c-evidence-completeness-lock-validation' },
  { anchor: '### N.17 Phase 15 exit-completion lock', testId: 'lang/contracts/usr-phase15-exit-lock-validation' },
  { anchor: '### N.18 Phase 15.2 reporting-integrity lock', testId: 'lang/contracts/usr-phase15-reporting-lock-validation' },
  { anchor: '### N.19 Phase 15.1 CI gate-integrity lock', testId: 'lang/contracts/usr-phase15-ci-gate-lock-validation' },
  { anchor: '### N.20 Phase 15.3 maintenance-integrity lock', testId: 'lang/contracts/usr-phase15-maintenance-lock-validation' },
  { anchor: '### N.21 Phase 14.3 integration/failure exit lock', testId: 'lang/contracts/usr-phase14-exit-lock-validation' },
  { anchor: '### N.22 Phase 11-13 conformance exit-integrity lock', testId: 'lang/contracts/usr-conformance-phase-exit-lock-validation' },
  { anchor: '### N.23 Phase 10.3 harness exit-integrity lock', testId: 'lang/contracts/usr-phase10-harness-exit-lock-validation' },
  { anchor: '### N.24 Phase 8.4 hardening exit-integrity lock', testId: 'lang/contracts/usr-phase8-exit-lock-validation' },
  { anchor: '### N.25 Phase 7.3 fixture/golden exit-integrity lock', testId: 'lang/contracts/usr-phase7-exit-lock-validation' },
  { anchor: '### N.26 Phase 6.6 semantics exit-integrity lock', testId: 'lang/contracts/usr-phase6-exit-lock-validation' }
];

const expectedAnchors = new Set(lockRows.map((row) => row.anchor));

for (const row of lockRows) {
  assert.equal(roadmapText.includes(row.anchor), true, `roadmap missing governance lock anchor: ${row.anchor}`);

  const testFilePath = path.join(repoRoot, 'tests', `${row.testId}.test.js`);
  assert.equal(fs.existsSync(testFilePath), true, `governance lock test file missing: tests/${row.testId}.test.js`);

  assert.equal(ciOrderText.includes(row.testId), true, `ci order missing governance lock test: ${row.testId}`);
  assert.equal(ciLiteOrderText.includes(row.testId), true, `ci-lite order missing governance lock test: ${row.testId}`);

  assert.equal(guideText.includes(`tests/${row.testId}.test.js`), true, `contract enforcement guide missing governance lock reference: tests/${row.testId}.test.js`);
}

const roadmapLockAnchors = new Set(
  [...roadmapText.matchAll(/^### N\.\d+ .*lock$/gm)].map((match) => match[0])
);

for (const anchor of roadmapLockAnchors) {
  assert.equal(expectedAnchors.has(anchor), true, `roadmap governance lock anchor has no suite mapping; update lockRows in governance lock suite validator: ${anchor}`);
}

for (const anchor of expectedAnchors) {
  assert.equal(roadmapLockAnchors.has(anchor), true, `governance lock suite mapping references missing roadmap anchor: ${anchor}`);
}

console.log('usr governance lock suite validation checks passed');
