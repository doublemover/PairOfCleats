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

const f1Section = extractSection(
  roadmapText,
  '### F.1 Rollout gates (USR section 26)',
  '### F.2 Backward compatibility and deprecation (USR section 27)'
);
const gateASection = extractSection(
  roadmapText,
  '### Gate A (B0 contracts/registries)',
  '### Gate B1-B7 (language batch gates)'
);
const gateCSection = extractSection(
  roadmapText,
  '### Gate C (test rollout)',
  '---\n\n## Appendix C - Exhaustive Per-Language Task Packs by Batch'
);
const phase11ExitSection = extractSection(
  roadmapText,
  '### 11.3 Exit criteria',
  '## Phase 12 - Deep Conformance C2/C3'
);
const phase12ExitSection = extractSection(
  roadmapText,
  '### 12.3 Exit criteria',
  '## Phase 13 - Framework Conformance C4'
);
const phase13ExitSection = extractSection(
  roadmapText,
  '### 13.2 Exit criteria',
  '## Phase 14 - Integration and Failure-Mode Enforcement'
);

const phaseA = checklistLineState(f1Section, 'Complete Phase A schema and registry readiness.');
const phaseB = checklistLineState(f1Section, 'Complete Phase B dual-write parity validation.');
const phaseC = checklistLineState(f1Section, 'Complete Phase C USR-backed production path validation.');
const phaseD = checklistLineState(f1Section, 'Complete Phase D full conformance enforcement.');

if (phaseA === 'checked') {
  assert.equal(hasUnchecked(gateASection), false, 'Appendix F.1 Phase A cannot be checked while Gate A has unchecked items');
}

if (phaseB === 'checked') {
  const backcompatLine = checklistLineState(gateCSection, 'backward-compat matrix strict scenarios are green in CI.');
  assert.equal(backcompatLine, 'checked', 'Appendix F.1 Phase B requires Gate C backward-compat matrix strict scenarios to be checked');
}

if (phaseC === 'checked') {
  const requiredGateCLines = [
    'implementation-readiness evidence validators are green for promotion target phase.',
    'blocking SLO budgets are green for required lanes.',
    'strict security gates are green in CI.',
    'strict blocking failure-injection scenarios are green in CI.',
    'fixture-governance validation is green for blocking fixture families.',
    'benchmark regression policy is green for blocking benchmark rows.',
    'threat-model critical coverage and abuse-case lanes are green.',
    'waiver expiry/breach enforcement checks are green.'
  ];

  for (const line of requiredGateCLines) {
    assert.equal(checklistLineState(gateCSection, line), 'checked', `Appendix F.1 Phase C requires Gate C evidence line to be checked: ${line}`);
  }
}

if (phaseD === 'checked') {
  assert.equal(checklistLineState(phase11ExitSection, 'All languages pass required C0/C1 checks.'), 'checked', 'Appendix F.1 Phase D requires Phase 11.3 C0/C1 exit criterion to be checked');
  assert.equal(checklistLineState(phase12ExitSection, 'Required C2/C3 profile checks pass.'), 'checked', 'Appendix F.1 Phase D requires Phase 12.3 C2/C3 exit criterion to be checked');
  assert.equal(checklistLineState(phase13ExitSection, 'All required framework profiles pass C4 checks.'), 'checked', 'Appendix F.1 Phase D requires Phase 13.2 C4 exit criterion to be checked');
  assert.equal(checklistLineState(gateCSection, 'conformance rollout authorized.'), 'checked', 'Appendix F.1 Phase D requires Gate C conformance rollout authorized to be checked');
}

for (const fragment of [
  'Appendix F.1 phase-evidence lock requirements:',
  '`Complete Phase B dual-write parity validation.` cannot be checked unless Gate C `backward-compat matrix strict scenarios are green in CI.` is checked.',
  '`Complete Phase D full conformance enforcement.` cannot be checked unless Phase 11.3, Phase 12.3, and Phase 13.2 exit criteria are checked and Gate C `conformance rollout authorized.` is checked.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing F.1 phase-evidence lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.14 Appendix F.1 phase-evidence lock'), true, 'roadmap must include Appendix N.14 F.1 phase-evidence lock policy');

for (const testId of [
  'lang/contracts/usr-rollout-phase-evidence-lock-validation',
  'lang/contracts/usr-rollout-f1-checklist-validation',
  'lang/contracts/usr-gate-c-authorization-chain-validation',
  'lang/contracts/usr-rollout-phase-gate-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing F.1 phase-evidence lock validator coverage: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing F.1 phase-evidence lock validator coverage: ${testId}`);
}

console.log('usr rollout phase-evidence lock validation checks passed');
