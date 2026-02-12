#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
const prTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');

const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');
const prTemplateText = fs.readFileSync(prTemplatePath, 'utf8');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));

const assertExists = (relativePath, label) => {
  const fullPath = path.join(repoRoot, relativePath.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(fullPath), true, `${label} missing required path: ${relativePath}`);
};

const assertTestInCiOrders = (testId, label) => {
  assert.equal(ciOrderText.includes(testId), true, `${label} missing CI lane test: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `${label} missing CI-lite lane test: ${testId}`);
};

// F.6.1 umbrella/decomposed synchronization enforcement anchors.
const requiredPrMarkers = [
  'usr-policy:change-control',
  'usr-policy:decomposed-workflow',
  'usr-policy:change-tiering',
  'usr-policy:appendix-sync'
];
for (const marker of requiredPrMarkers) {
  assert.equal(prTemplateText.includes(`<!-- ${marker} -->`), true, `F.6.1 missing PR template governance marker: ${marker}`);
}

assertExists('docs/specs/unified-syntax-representation.md', 'F.6.1 umbrella contract');
assertExists('docs/specs/usr-consolidation-coverage-matrix.md', 'F.6.1 decomposed contract map');
assertTestInCiOrders('lang/contracts/usr-pr-template-policy-validation', 'F.6.1');
assertTestInCiOrders('lang/contracts/usr-roadmap-sync', 'F.6.1');
assertTestInCiOrders('lang/contracts/usr-governance-lock-suite-validation', 'F.6.1');

// F.6.2 per-language contract synchronization.
assertExists('docs/specs/usr/languages', 'F.6.2 language contract directory');
const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];
for (const row of languageRows) {
  assertExists(`docs/specs/usr/languages/${row.id}.md`, `F.6.2 language contract for ${row.id}`);
}
assertTestInCiOrders('lang/contracts/usr-language-contract-template', 'F.6.2');
assertTestInCiOrders('lang/contracts/usr-language-contract-freshness-validation', 'F.6.2');
assertTestInCiOrders('lang/contracts/usr-matrix-driven-harness-validation', 'F.6.2');

// F.6.3 framework and risk contract synchronization.
assertExists('docs/specs/usr-core-language-framework-catalog.md', 'F.6.3 framework contract');
assertExists('docs/specs/usr-core-security-risk-compliance.md', 'F.6.3 risk contract');
assertExists('tests/lang/matrix/usr-framework-edge-cases.json', 'F.6.3 framework edge-case matrix');
assertExists('tests/lang/matrix/usr-language-risk-profiles.json', 'F.6.3 language risk profile matrix');
const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];
assert.equal(frameworkRows.length > 0, true, 'F.6.3 framework profile registry must contain rows');
assertTestInCiOrders('lang/contracts/usr-framework-contract-freshness-validation', 'F.6.3');
assertTestInCiOrders('lang/contracts/usr-framework-contract-matrix-sync-validation', 'F.6.3');
assertTestInCiOrders('lang/contracts/usr-framework-canonicalization', 'F.6.3');
assertTestInCiOrders('lang/contracts/usr-language-risk-profile-validation', 'F.6.3');

// F.6.4 registry schema and readiness synchronization.
assertExists('docs/specs/usr-core-artifact-schema-catalog.md', 'F.6.4 artifact/schema catalog');
assertExists('docs/specs/usr-rollout-approval-lock.md', 'F.6.4 rollout approval lock contract');
assertExists('tests/lang/matrix/usr-operational-readiness-policy.json', 'F.6.4 operational readiness policy matrix');
assertExists('tests/lang/matrix/usr-quality-gates.json', 'F.6.4 quality-gate matrix');
assertTestInCiOrders('lang/contracts/usr-core-artifact-schema-catalog-alignment', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-gate-a-registry-readiness-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-harness-lane-materialization-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-rollout-f1-checklist-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-rollout-phase-evidence-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-phase9-gonogo-decision-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-conformance-phase-exit-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-phase9-readiness-authorization-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-phase9-readiness-audit-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-gate-b-language-batch-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-gate-c-evidence-completeness-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-gate-c-authorization-chain-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-rollout-approval-lock-validation', 'F.6.4');
assertTestInCiOrders('lang/contracts/usr-implementation-readiness-validation', 'F.6.4');

// F.6.5 observability/SLO and security-governance synchronization.
assertExists('docs/specs/usr-core-observability-performance-ops.md', 'F.6.5 observability contract');
assertExists('docs/specs/usr-core-security-risk-compliance.md', 'F.6.5 security contract');
assertExists('tests/lang/matrix/usr-slo-budgets.json', 'F.6.5 SLO budget matrix');
assertExists('tests/lang/matrix/usr-security-gates.json', 'F.6.5 security gate matrix');
assertExists('tests/lang/matrix/usr-threat-model-matrix.json', 'F.6.5 threat model matrix');
assertTestInCiOrders('lang/contracts/usr-observability-rollup-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase14-exit-lock-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase15-ci-gate-lock-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase15-reporting-lock-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase15-maintenance-lock-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase15-exit-lock-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-phase8-hardening-readiness-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-fixture-golden-readiness-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-benchmark-policy-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-cross-batch-regression-resolution-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-security-gate-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-failure-injection-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-failure-injection-recovery-threshold-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-failure-mode-suite-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-mixed-repo-integration-validation', 'F.6.5');
assertTestInCiOrders('lang/contracts/usr-threat-model-coverage-validation', 'F.6.5');

console.log('usr F.6 synchronization requirements validation checks passed');
