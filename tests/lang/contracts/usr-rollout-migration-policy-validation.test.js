#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUsrReportIds } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const rolloutSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-rollout-release-migration.md');
const runtimeConfigPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-runtime-config-policy.json');
const operationalReadinessPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-operational-readiness-policy.json');
const evidenceGatesSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-evidence-gates-waivers.md');
const rolloutApprovalLockPath = path.join(repoRoot, 'docs', 'specs', 'usr-rollout-approval-lock.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
const operationalReadiness = JSON.parse(fs.readFileSync(operationalReadinessPath, 'utf8'));
const evidenceGatesSpecText = fs.readFileSync(evidenceGatesSpecPath, 'utf8');
const rolloutApprovalLockText = fs.readFileSync(rolloutApprovalLockPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const requiredSpecAnchors = [
  '## Rollout phases',
  '| `shadow-read` |',
  '| `dual-write` |',
  '| `strict-gate pre-cutover` |',
  '| `cutover` |',
  '| `post-cutover stabilization` |',
  '## Compatibility policy',
  'BC-001` through `BC-012',
  '## Operational readiness requirements',
  'Appendix F.1 checklist promotion lock requirements:',
  'Phase 9 readiness authorization lock requirements:',
  'Gate B1-B7 language-batch completion lock requirements:',
  'Phase 9.1 readiness-audit completion lock requirements:',
  'Gate C conformance-authorization chain lock requirements:',
  'Appendix F.1 phase-evidence lock requirements:',
  'Phase 9.2 go/no-go decision lock requirements:',
  'Gate C evidence-completeness lock requirements:',
  '## Rollback policy',
  '## Required outputs'
];

for (const anchor of requiredSpecAnchors) {
  assert.equal(rolloutSpecText.includes(anchor), true, `rollout/migration spec missing required anchor: ${anchor}`);
}

assert.equal(rolloutSpecText.includes('`tests/lang/matrix/usr-backcompat-matrix.json`'), true, 'rollout spec must reference backcompat matrix artifact');
assert.equal(rolloutSpecText.includes('`usr-operational-readiness-validation.json`'), true, 'rollout spec must require operational readiness report output');
assert.equal(rolloutSpecText.includes('`usr-backcompat-matrix-results.json`'), true, 'rollout spec must require backcompat results output');
assert.equal(rolloutSpecText.includes('`docs/specs/usr-rollout-approval-lock.md`'), true, 'rollout spec must reference rollout approval lock contract');
assert.equal(/^Approval state:\s+`(pending|approved)`$/m.test(rolloutApprovalLockText), true, 'rollout approval lock must declare pending|approved state');

const requiredOutputArtifactIds = [
  'usr-backcompat-matrix-results',
  'usr-operational-readiness-validation',
  'usr-incident-response-drill-report',
  'usr-rollback-drill-report',
  'usr-release-train-readiness',
  'usr-no-cut-decision-log',
  'usr-post-cutover-stabilization-report'
];

const reportIds = new Set(listUsrReportIds());
for (const artifactId of requiredOutputArtifactIds) {
  assert.equal(rolloutSpecText.includes(`\`${artifactId}.json\``), true, `rollout spec required outputs must include artifact: ${artifactId}.json`);
  assert.equal(reportIds.has(artifactId), true, `rollout required output must have registered report schema validator: ${artifactId}`);

  const schemaPath = path.join(repoRoot, 'docs', 'schemas', 'usr', `${artifactId}.schema.json`);
  assert.equal(fs.existsSync(schemaPath), true, `rollout required output must have schema file: docs/schemas/usr/${artifactId}.schema.json`);
}

for (const artifactId of ['usr-release-train-readiness', 'usr-no-cut-decision-log', 'usr-post-cutover-stabilization-report']) {
  assert.equal(evidenceGatesSpecText.includes(`\`${artifactId}.json\``), true, `evidence-gates spec must include rollout artifact in standard evidence set: ${artifactId}.json`);
}

const runtimeRows = Array.isArray(runtimeConfig.rows) ? runtimeConfig.rows : [];
assert.equal(runtimeRows.length > 0, true, 'runtime-config policy must define config rows');

const runtimeKeys = new Set(runtimeRows.map((row) => row.key).filter((key) => typeof key === 'string'));
const requiredRolloutFlags = ['usr.rollout.shadowReadEnabled', 'usr.rollout.cutoverEnabled'];
for (const flag of requiredRolloutFlags) {
  assert.equal(runtimeKeys.has(flag), true, `runtime-config policy must enforce rollout flag key: ${flag}`);
}

const readinessRows = Array.isArray(operationalReadiness.rows) ? operationalReadiness.rows : [];
const phasesPresent = new Set(readinessRows.map((row) => row.phase));
for (const phase of ['pre-cutover', 'cutover', 'incident', 'post-cutover']) {
  assert.equal(phasesPresent.has(phase), true, `operational-readiness policy missing rollout phase: ${phase}`);
}

const requiredCiTests = [
  'lang/contracts/usr-rollout-migration-policy-validation',
  'lang/contracts/usr-rollout-phase-gate-validation',
  'lang/contracts/usr-rollout-f1-checklist-validation',
  'lang/contracts/usr-rollout-phase-evidence-lock-validation',
  'lang/contracts/usr-phase9-gonogo-decision-lock-validation',
  'lang/contracts/usr-phase9-readiness-authorization-lock-validation',
  'lang/contracts/usr-phase9-readiness-audit-lock-validation',
  'lang/contracts/usr-gate-b-language-batch-lock-validation',
  'lang/contracts/usr-gate-c-evidence-completeness-lock-validation',
  'lang/contracts/usr-gate-c-authorization-chain-validation',
  'lang/contracts/usr-rollout-approval-lock-validation',
  'lang/contracts/usr-runtime-config-feature-flag-validation',
  'lang/contracts/usr-implementation-readiness-validation',
  'backcompat/backcompat-matrix-validation'
];

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing rollout/migration validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing rollout/migration validator: ${testId}`);
}

console.log('usr rollout/migration policy validation checks passed');
