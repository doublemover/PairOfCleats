#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');
const prTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
const releaseTemplatePath = path.join(repoRoot, '.github', 'release_template.md');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');
const prTemplateText = fs.readFileSync(prTemplatePath, 'utf8');
const releaseTemplateText = fs.readFileSync(releaseTemplatePath, 'utf8');

const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

const maintenanceSection = extractSection(roadmapText, '### 15.3 Maintenance', '### 15.4 Exit criteria');
assert.equal(/- \[ \] /.test(maintenanceSection), false, 'phase 15.3 maintenance checklist must not contain unchecked items');

const backwardCompatSection = extractSection(roadmapText, '### F.2 Backward compatibility and deprecation (USR section 27)', '### F.3 Change-control (USR section 28)');
assert.equal(/- \[ \] /.test(backwardCompatSection), false, 'appendix F.2 backward-compat/deprecation checklist must not contain unchecked items');

const changeControlSection = extractSection(roadmapText, '### F.3 Change-control (USR section 28)', '### F.4 Extension policy (USR section 29)');
assert.equal(/- \[ \] /.test(changeControlSection), false, 'appendix F.3 change-control checklist must not contain unchecked items');

const extensionPolicySection = extractSection(roadmapText, '### F.4 Extension policy (USR section 29)', '### F.5 Diagnostics/examples/canonicalization/backcompat hard requirements (USR sections 33-36)');
assert.equal(/- \[ \] /.test(extensionPolicySection), false, 'appendix F.4 extension-policy checklist must not contain unchecked items');

const f5HardRequirementsSection = extractSection(roadmapText, '### F.5 Diagnostics/examples/canonicalization/backcompat hard requirements (USR sections 33-36)', '### F.6 Decomposed contract synchronization requirements');
assert.equal(/- \[ \] /.test(f5HardRequirementsSection), false, 'appendix F.5 hard-requirements checklist must not contain unchecked items');

const f6SyncRequirementsSection = extractSection(roadmapText, '### F.6 Decomposed contract synchronization requirements', '---');
assert.equal(/- \[ \] /.test(f6SyncRequirementsSection), false, 'appendix F.6 synchronization checklist must not contain unchecked items');

const phaseSevenFixtureSection = extractSection(roadmapText, '### 7.1 Fixture completeness', '### 7.2 Golden generation and review');
assert.equal(phaseSevenFixtureSection.includes('- [x] Ensure every per-language contract has concrete fixture ID mappings and fixture family coverage.'), true, 'phase 7.1 must retain per-language fixture ID mapping coverage control');
assert.equal(phaseSevenFixtureSection.includes('- [x] Enforce fixture-governance coverage floor for every language/framework profile across required conformance levels and semantic families.'), true, 'phase 7.1 must retain fixture-governance coverage floor control');
assert.equal(phaseSevenFixtureSection.includes('- [x] Add fixture mutation-policy tags (`require-rfc|require-review|allow-generated-refresh`) and validate policy coverage.'), true, 'phase 7.1 must retain fixture mutation-policy coverage control');

const phaseSevenGoldenSection = extractSection(roadmapText, '### 7.2 Golden generation and review', '### 7.3 Exit criteria');
assert.equal(phaseSevenGoldenSection.includes('- [x] Add fixture-to-roadmap linkage tags for every language and framework task pack.'), true, 'phase 7.2 must retain fixture-to-roadmap linkage control');

const phaseNineReadinessSection = extractSection(roadmapText, '### 9.1 Readiness audit', '### 9.2 Go/No-Go decision');
assert.equal(phaseNineReadinessSection.includes('- [x] Materialize framework extension contract template governance and CI enforcement controls.'), true, 'phase 9.1 must retain framework contract governance scaffold control');
assert.equal(phaseNineReadinessSection.includes('- [x] Enforce language-contract vs language-profile matrix exact-set synchronization for conformance/framework/node/edge declarations.'), true, 'phase 9.1 must retain language contract matrix-sync governance control');
assert.equal(phaseNineReadinessSection.includes('- [x] Materialize per-language approval checklist and completion evidence scaffolding in `docs/specs/usr/languages/*.md`.'), true, 'phase 9.1 must retain per-language approval/evidence scaffold control');
assert.equal(phaseNineReadinessSection.includes('- [x] Enforce phase-9 readiness evidence gate coverage across CI validators and required report artifacts.'), true, 'phase 9.1 must retain phase-9 readiness evidence gate control');

const appendixMSection = extractSection(roadmapText, 'Roadmap enforcement requirements:', '## Appendix N - Phase 0 Governance Lock Artifacts');
assert.equal(appendixMSection.includes('- [x] Every phase gate links to at least one concrete evidence artifact in `docs/specs/usr-core-evidence-gates-waivers.md`.'), true, 'appendix M must mark phase-to-evidence linkage requirement complete');
assert.equal(appendixMSection.includes('- [x] Every blocking evidence artifact has an active schema in `docs/schemas/usr/*.json` and a row in `docs/specs/usr-core-artifact-schema-catalog.md`.'), true, 'appendix M must mark blocking evidence schema-catalog coverage requirement complete');
assert.equal(appendixMSection.includes('### M.1 Phase-to-gate evidence artifact map'), true, 'appendix M must include phase-to-gate evidence artifact map section');
assert.equal(appendixMSection.includes('| 0 | `usr-validation-report.json`, `usr-drift-report.json` |'), true, 'appendix M evidence map must include phase 0 artifact mapping');
assert.equal(appendixMSection.includes('| 15 | `usr-release-readiness-scorecard.json`, `usr-waiver-expiry-report.json`, `usr-observability-rollup.json` |'), true, 'appendix M evidence map must include phase 15 artifact mapping');
assert.equal(appendixMSection.includes('- [x] CI contract enforcement follows `docs/guides/usr-contract-enforcement.md`.'), true, 'appendix M must mark CI contract enforcement requirement complete');
assert.equal(appendixMSection.includes('- [x] New language onboarding follows `docs/guides/usr-new-language-onboarding.md`.'), true, 'appendix M must mark new-language onboarding requirement complete');
assert.equal(appendixMSection.includes('- [x] Framework onboarding and interop expectations follow `docs/specs/usr-core-language-framework-catalog.md`.'), true, 'appendix M must mark framework interop onboarding requirement complete');
assert.equal(appendixMSection.includes('- [x] Contract consolidation traceability is maintained in `docs/specs/usr-consolidation-coverage-matrix.md`.'), true, 'appendix M must mark consolidation traceability requirement complete');

const requiredCiTests = [
  'lang/contracts/usr-contract-enforcement',
  'lang/contracts/usr-core-artifact-schema-catalog-alignment',
  'lang/contracts/usr-blocking-evidence-schema-catalog-validation',
  'lang/contracts/usr-change-tier-policy-validation',
  'lang/contracts/usr-extension-policy-validation',
  'lang/contracts/usr-onboarding-policy-validation',
  'lang/contracts/usr-roadmap-sync',
  'lang/contracts/usr-traceability-approval-validation',
  'lang/contracts/usr-pr-template-policy-validation',
  'lang/contracts/usr-framework-contract-template-validation',
  'lang/contracts/usr-language-contract-matrix-sync-validation',
  'lang/contracts/usr-language-contract-freshness-validation',
  'lang/contracts/usr-diagnostic-remediation-routing-validation',
  'lang/contracts/usr-canonical-example-validation',
  'lang/contracts/usr-framework-canonicalization',
  'lang/contracts/usr-framework-profile-matrix-sync-validation',
  'lang/contracts/usr-phase9-readiness-evidence-validation',
  'lang/contracts/usr-f5-hard-requirements-validation',
  'lang/contracts/usr-f6-sync-requirements-validation',
  'lang/contracts/usr-rollout-migration-policy-validation',
  'lang/contracts/usr-rollout-phase-gate-validation',
  'lang/contracts/usr-archival-deprecation-policy-validation',
  'backcompat/backcompat-matrix-validation',
  'lang/contracts/usr-runtime-config-feature-flag-validation',
  'lang/contracts/usr-failure-injection-validation',
  'lang/contracts/usr-fixture-governance-validation',
  'lang/contracts/usr-fixture-mutation-policy-coverage-validation',
  'lang/contracts/usr-fixture-governance-coverage-floor-validation',
  'lang/contracts/usr-benchmark-policy-validation',
  'lang/contracts/usr-threat-model-coverage-validation',
  'lang/contracts/usr-waiver-policy-validation',
  'lang/contracts/usr-report-envelope-validation',
  'lang/contracts/usr-report-schema-file-coverage-validation',
  'lang/contracts/usr-doc-schema-contract-validation',
  'decomposed-drift/decomposed-drift-validation'
];

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order must include maintenance control validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order must include maintenance control validator: ${testId}`);
}

const requiredPrMarkers = [
  'usr-policy:change-control',
  'usr-policy:decomposed-workflow',
  'usr-policy:change-tiering',
  'usr-policy:extension-policy',
  'usr-policy:appendix-sync',
  'usr-policy:deprecation-archive',
  'usr-policy:registry-drift',
  'usr-policy:parser-lock',
  'usr-policy:runtime-config',
  'usr-policy:failure-injection',
  'usr-policy:benchmark-slo',
  'usr-policy:threat-model',
  'usr-policy:waiver-governance'
];

for (const marker of requiredPrMarkers) {
  assert.equal(prTemplateText.includes(`<!-- ${marker} -->`), true, `PR template missing maintenance policy marker: ${marker}`);
}

assert.equal(releaseTemplateText.includes('<!-- usr-policy:waiver-governance-release -->'), true, 'release template must include waiver-governance release policy marker');
assert.equal(/expiry cadence/i.test(releaseTemplateText), true, 'release template must require waiver expiry cadence review');

console.log('usr maintenance controls stability checks passed');
