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
const languageContractsDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const phase91Section = extractSection(roadmapText, '### 9.1 Readiness audit', '### 9.2 Go/No-Go decision');
const phase93Section = extractSection(roadmapText, '### 9.3 Exit criteria', '## Phase 10 - Harness and Lane Materialization');
const gateB1Section = extractSection(roadmapText, '### Gate B1-B7 (language batch gates)', '### Gate B8 (cross-batch integration)');
const gateB8Section = extractSection(roadmapText, '### Gate B8 (cross-batch integration)', '### Gate C (test rollout)');

const taskPackEvidenceValidated = checklistLineState(phase91Section, 'Validate completion evidence for all B1-B7 task packs.');
const languageApprovalValidated = checklistLineState(phase91Section, 'Validate per-language contract approval checklists are complete for target rollout set.');
const readinessReportApproved = checklistLineState(phase93Section, 'Readiness report approved.');
const testRolloutAuthorized = checklistLineState(phase93Section, 'Test rollout authorized.');

if (taskPackEvidenceValidated === 'checked') {
  assert.equal(hasUnchecked(gateB1Section), false, 'phase 9.1 task-pack evidence line cannot be checked while Gate B1-B7 has unchecked items');
  assert.equal(hasUnchecked(gateB8Section), false, 'phase 9.1 task-pack evidence line cannot be checked while Gate B8 has unchecked items');
}

const languageContractFiles = fs.readdirSync(languageContractsDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => path.join(languageContractsDir, name));
assert.equal(languageContractFiles.length > 0, true, 'phase 9.1 language-approval lock requires language contract files in docs/specs/usr/languages');

if (languageApprovalValidated === 'checked') {
  const filesWithUncheckedApproval = [];
  for (const filePath of languageContractFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    const approvalStart = text.indexOf('## Approval checklist');
    assert.notEqual(approvalStart, -1, `language contract is missing required approval checklist section: ${path.basename(filePath)}`);
    const approvalSection = text.slice(approvalStart);
    if (hasUnchecked(approvalSection)) {
      filesWithUncheckedApproval.push(path.basename(filePath));
    }
  }
  assert.deepEqual(filesWithUncheckedApproval, [], `phase 9.1 language-approval line cannot be checked while language approval checklists contain unchecked items: ${filesWithUncheckedApproval.join(', ')}`);
}

if ((taskPackEvidenceValidated === 'unchecked' || languageApprovalValidated === 'unchecked') && (readinessReportApproved === 'checked' || testRolloutAuthorized === 'checked')) {
  assert.fail('phase 9.3 readiness/test-rollout authorization lines must remain unchecked while phase 9.1 readiness-audit lock dependencies are unchecked');
}

for (const fragment of [
  'Phase 9.1 readiness-audit completion lock requirements:',
  '`Validate completion evidence for all B1-B7 task packs.` cannot be checked while Gate B1-B7 or Gate B8 checklist lines remain unchecked.',
  '`Validate per-language contract approval checklists are complete for target rollout set.` cannot be checked while any file in `docs/specs/usr/languages/*.md` contains unchecked approval checklist lines.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-9.1 readiness lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.12 Phase 9.1 readiness-audit completion lock'), true, 'roadmap must include Appendix N.12 phase-9.1 readiness-audit lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase9-readiness-audit-lock-validation',
    'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
    'lang/contracts/usr-gate-c-authorization-chain-validation',
    'lang/contracts/usr-gate-b-language-batch-lock-validation',
    'lang/contracts/usr-rollout-f1-checklist-validation'
  ],
  'phase-9.1 readiness lock validator coverage',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 9.1 readiness-audit lock validation checks passed');
