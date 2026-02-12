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
const scorecardSchemaPath = path.join(repoRoot, 'docs', 'schemas', 'usr', 'usr-release-readiness-scorecard.schema.json');
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

const phase152Section = extractSection(roadmapText, '### 15.2 Reporting', '### 15.3 Maintenance');
const phase154Section = extractSection(roadmapText, '### 15.4 Exit criteria', '---\n\n## Appendix A - USR Spec to Roadmap Traceability');
const phase15Exit = checklistLineState(phase154Section, 'CI and maintenance controls are stable for ongoing development.');

const section30Validation = checklistLineState(
  phase152Section,
  'Validate section 30 report envelopes and row schemas per `docs/specs/usr-core-observability-performance-ops.md`.'
);
const section31Scorecard = checklistLineState(
  phase152Section,
  'Emit automated section 31 scorecard artifact (`usr-release-readiness-scorecard.json`).'
);
const runtimeDashboard = checklistLineState(
  phase152Section,
  'Emit runtime configuration and feature-flag state dashboards.'
);
const failureDashboard = checklistLineState(
  phase152Section,
  'Emit failure-injection scenario pass/fail and recovery dashboards.'
);
const fixtureDashboard = checklistLineState(
  phase152Section,
  'Emit fixture-governance coverage and mutation-policy compliance dashboards.'
);
const benchmarkDashboard = checklistLineState(
  phase152Section,
  'Emit benchmark regression and variance dashboards with lane/profile dimensions.'
);
const threatDashboard = checklistLineState(
  phase152Section,
  'Emit threat-model coverage, abuse-case results, and control-gap dashboards.'
);
const waiverDashboard = checklistLineState(
  phase152Section,
  'Emit waiver active/expiry/breach dashboards and scorecard linkage.'
);
const conformanceDashboard = checklistLineState(
  phase152Section,
  'Emit language-level conformance dashboards.'
);
const bridgeDashboard = checklistLineState(
  phase152Section,
  'Emit embedded-language bridge coverage and failure dashboards.'
);
const provenanceDashboard = checklistLineState(
  phase152Section,
  'Emit generated/macro provenance coverage and confidence-downgrade dashboards.'
);
const observabilityDashboard = checklistLineState(
  phase152Section,
  'Emit SLO budget compliance and alert evaluation dashboards.'
);
const securityDashboard = checklistLineState(
  phase152Section,
  'Emit redaction/security gate compliance dashboards.'
);
const backcompatRollup = checklistLineState(
  phase152Section,
  'Emit compatibility matrix rollups including required section 36.8 dimensions.'
);
const capabilityTransitionReport = checklistLineState(
  phase152Section,
  'Emit capability transition and degradation reports.'
);

const assertTestsPresent = (testIds, context) => {
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${context} dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${context} dependency: ${testId}`);
  }
};

if (section30Validation === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-report-envelope-validation',
      'lang/contracts/usr-report-schema-file-coverage-validation',
      'lang/contracts/usr-doc-schema-contract-validation'
    ],
    'phase 15.2 section-30 reporting lock'
  );
}

if (section31Scorecard === 'checked') {
  assert.equal(fs.existsSync(scorecardSchemaPath), true, 'phase 15.2 section-31 scorecard lock requires usr-release-readiness-scorecard schema file');
  assertTestsPresent(
    [
      'lang/contracts/usr-implementation-readiness-validation',
      'lang/contracts/usr-phase15-reporting-lock-validation'
    ],
    'phase 15.2 section-31 scorecard lock'
  );
}

if (runtimeDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-runtime-config-feature-flag-validation'], 'phase 15.2 runtime dashboard lock');
}

if (failureDashboard === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-failure-injection-validation',
      'lang/contracts/usr-failure-injection-recovery-threshold-validation',
      'lang/contracts/usr-failure-mode-suite-validation'
    ],
    'phase 15.2 failure dashboard lock'
  );
}

if (fixtureDashboard === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-fixture-governance-validation',
      'lang/contracts/usr-fixture-mutation-policy-coverage-validation',
      'lang/contracts/usr-fixture-golden-readiness-validation'
    ],
    'phase 15.2 fixture dashboard lock'
  );
}

if (benchmarkDashboard === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-benchmark-policy-validation',
      'lang/contracts/usr-cross-batch-regression-resolution-validation'
    ],
    'phase 15.2 benchmark dashboard lock'
  );
}

if (threatDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-threat-model-coverage-validation'], 'phase 15.2 threat dashboard lock');
}

if (waiverDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-waiver-policy-validation'], 'phase 15.2 waiver dashboard lock');
}

if (conformanceDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-conformance-dashboard-validation'], 'phase 15.2 conformance dashboard lock');
}

if (bridgeDashboard === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-embedding-bridge-validation',
      'lang/contracts/usr-bridge-provenance-dashboard-validation'
    ],
    'phase 15.2 embedded bridge dashboard lock'
  );
}

if (provenanceDashboard === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-generated-provenance-validation',
      'lang/contracts/usr-bridge-provenance-dashboard-validation'
    ],
    'phase 15.2 generated provenance dashboard lock'
  );
}

if (observabilityDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-observability-rollup-validation'], 'phase 15.2 observability dashboard lock');
}

if (securityDashboard === 'checked') {
  assertTestsPresent(['lang/contracts/usr-security-gate-validation'], 'phase 15.2 security dashboard lock');
}

if (backcompatRollup === 'checked') {
  assertTestsPresent(['backcompat/backcompat-matrix-validation'], 'phase 15.2 backcompat rollup lock');
}

if (capabilityTransitionReport === 'checked') {
  assertTestsPresent(['lang/contracts/usr-phase8-hardening-readiness-validation'], 'phase 15.2 capability-transition reporting lock');
}

if (hasUnchecked(phase152Section) && phase15Exit === 'checked') {
  assert.fail('phase 15 exit must be reopened when phase 15.2 reporting prerequisites are not fully checked');
}

for (const fragment of [
  'Phase 15.2 reporting-integrity lock requirements:',
  '`Validate section 30 report envelopes and row schemas per docs/specs/usr-core-observability-performance-ops.md.` cannot be checked unless report envelope/schema contract validators remain present in required CI lanes.',
  '`Emit automated section 31 scorecard artifact (usr-release-readiness-scorecard.json).` cannot be checked unless the scorecard schema exists and implementation-readiness validators remain present in required CI lanes.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-15.2 reporting lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.18 Phase 15.2 reporting-integrity lock'), true, 'roadmap must include Appendix N.18 phase-15.2 reporting-integrity lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase15-reporting-lock-validation',
    'lang/contracts/usr-phase15-exit-lock-validation',
    'lang/contracts/usr-rollout-migration-policy-validation',
    'lang/contracts/usr-rollout-phase-gate-validation'
  ],
  'phase 15.2 reporting lock umbrella'
);

console.log('usr phase 15.2 reporting lock validation checks passed');
