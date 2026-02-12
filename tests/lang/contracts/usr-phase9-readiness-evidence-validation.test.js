#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUsrReportIds } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
const artifactCatalogPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-artifact-schema-catalog.md');
const evidenceGatesPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-evidence-gates-waivers.md');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');
const artifactCatalogText = fs.readFileSync(artifactCatalogPath, 'utf8');
const evidenceGatesText = fs.readFileSync(evidenceGatesPath, 'utf8');

const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

const phaseNineReadinessSection = extractSection(roadmapText, '### 9.1 Readiness audit', '### 9.2 Go/No-Go decision');

for (const checkedLine of [
  '- [x] Validate framework profile completion evidence.',
  '- [x] Validate conformance matrix readiness by language.',
  '- [x] Validate section 36 compatibility matrix readiness and blocking policy evidence.',
  '- [x] Validate implementation-readiness contract evidence set is complete for promotion target phase.',
  '- [x] Validate runtime config policy evidence and feature-flag state outputs are complete.',
  '- [x] Validate blocking failure-injection evidence and recovery artifacts are complete.',
  '- [x] Validate fixture-governance validation evidence for blocking fixture families is complete.',
  '- [x] Validate benchmark policy evidence and regression/variance reports are complete for blocking lanes.',
  '- [x] Validate threat-model coverage and abuse-case execution evidence are complete.',
  '- [x] Validate waiver-policy evidence (active/expiry/breach reports) and approver controls are complete.'
]) {
  assert.equal(phaseNineReadinessSection.includes(checkedLine), true, `phase 9 readiness checklist missing checked control: ${checkedLine}`);
}

const appendixMSection = extractSection(roadmapText, '### M.1 Phase-to-gate evidence artifact map', '## Appendix N - Phase 0 Governance Lock Artifacts');
assert.equal(appendixMSection.includes('| 9 | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json` |'), true, 'appendix M must include phase 9 evidence artifact mapping');

for (const testId of [
  'backcompat/backcompat-matrix-validation',
  'lang/contracts/usr-framework-contract-matrix-sync-validation',
  'lang/contracts/usr-conformance-matrix-readiness-by-language-validation',
  'lang/contracts/usr-implementation-readiness-validation',
  'lang/contracts/usr-runtime-config-feature-flag-validation',
  'lang/contracts/usr-failure-injection-validation',
  'lang/contracts/usr-fixture-governance-validation',
  'lang/contracts/usr-fixture-governance-coverage-floor-validation',
  'lang/contracts/usr-benchmark-policy-validation',
  'lang/contracts/usr-threat-model-coverage-validation',
  'lang/contracts/usr-waiver-policy-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing phase 9 readiness validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing phase 9 readiness validator: ${testId}`);
}

const reportIds = new Set(listUsrReportIds());
const requiredArtifactIds = [
  'usr-operational-readiness-validation',
  'usr-release-readiness-scorecard',
  'usr-backcompat-matrix-results',
  'usr-feature-flag-state',
  'usr-failure-injection-report',
  'usr-rollback-drill-report',
  'usr-benchmark-summary',
  'usr-benchmark-regression-summary',
  'usr-threat-model-coverage-report',
  'usr-waiver-active-report',
  'usr-waiver-expiry-report'
];

for (const artifactId of requiredArtifactIds) {
  assert.equal(reportIds.has(artifactId), true, `phase 9 readiness artifact must have registered report schema validator: ${artifactId}`);

  const schemaRelativePath = `docs/schemas/usr/${artifactId}.schema.json`;
  const schemaFullPath = path.join(repoRoot, schemaRelativePath.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(schemaFullPath), true, `phase 9 readiness artifact schema missing: ${schemaRelativePath}`);

  const tableRowPrefix = `| \`${artifactId}\` | \`${schemaRelativePath}\` |`;
  assert.equal(artifactCatalogText.includes(tableRowPrefix), true, `artifact schema catalog missing phase 9 readiness artifact row: ${artifactId}`);

  assert.equal(evidenceGatesText.includes(`- \`${artifactId}.json\``), true, `evidence gate contract missing phase 9 readiness artifact reference: ${artifactId}.json`);
}

console.log('usr phase-9 readiness evidence validation checks passed');
