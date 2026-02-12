#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestsPresent, checklistLineState, extractSection } from './usr-lock-test-utils.js';

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

const phase66Section = extractSection(roadmapText, '### 6.6 Exit criteria', '---\n\n## Phase 7 - Fixture and Golden Corpus Expansion');

const c2c3Exit = checklistLineState(phase66Section, 'C2/C3 requirements pass for required profiles.');
const capabilityExit = checklistLineState(phase66Section, 'Capability transition diagnostics are correct and complete.');
const provenanceExit = checklistLineState(phase66Section, 'Embedded/provenance semantics are validated for required language/framework profiles.');
const securityExit = checklistLineState(phase66Section, 'Security and redaction semantics are validated for required profiles and lanes.');
const threatExit = checklistLineState(phase66Section, 'Critical threat-model coverage and abuse-case mappings are validated for required lanes.');

if (c2c3Exit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-c2-baseline-validation',
      'lang/contracts/usr-c3-baseline-validation',
      'lang/contracts/usr-language-risk-profile-validation'
    ],
    'phase 6.6 C2/C3 lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (capabilityExit === 'checked') {
  assertTestsPresent(
    [
      'diagnostics/diagnostics-transition-validation',
      'lang/contracts/usr-phase8-hardening-readiness-validation'
    ],
    'phase 6.6 capability-transition lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (provenanceExit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-embedding-bridge-validation',
      'lang/contracts/usr-generated-provenance-validation',
      'lang/contracts/usr-bridge-provenance-dashboard-validation'
    ],
    'phase 6.6 embedded/provenance lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (securityExit === 'checked' || threatExit === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-security-gate-validation',
      'lang/contracts/usr-threat-model-coverage-validation',
      'lang/contracts/usr-failure-mode-suite-validation'
    ],
    'phase 6.6 security/threat lock',
    ciOrderText,
    ciLiteOrderText
  );
}

for (const fragment of [
  'Phase 6.6 semantics exit-integrity lock requirements:',
  '`C2/C3 requirements pass for required profiles.` cannot be checked unless C2/C3 and language-risk validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Capability transition diagnostics are correct and complete.` cannot be checked unless diagnostics transition and phase-8 hardening validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Embedded/provenance semantics are validated for required language/framework profiles.` cannot be checked unless embedding/provenance validators remain present in `ci` and `ci-lite` lane manifests.',
  '`Security and redaction semantics are validated for required profiles and lanes.` and `Critical threat-model coverage and abuse-case mappings are validated for required lanes.` cannot be checked unless security/threat validators remain present in `ci` and `ci-lite` lane manifests.'
]) {
  if (!rolloutSpecText.includes(fragment)) {
    throw new Error(`rollout migration contract missing phase-6.6 semantics lock fragment: ${fragment}`);
  }
}

if (!roadmapText.includes('### N.26 Phase 6.6 semantics exit-integrity lock')) {
  throw new Error('roadmap must include Appendix N.26 phase-6.6 semantics exit lock policy');
}

assertTestsPresent(
  [
    'lang/contracts/usr-phase6-exit-lock-validation',
    'lang/contracts/usr-c2-baseline-validation',
    'lang/contracts/usr-c3-baseline-validation',
    'lang/contracts/usr-language-risk-profile-validation',
    'lang/contracts/usr-security-gate-validation',
    'lang/contracts/usr-threat-model-coverage-validation'
  ],
  'phase 6.6 semantics lock umbrella',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 6.6 semantics exit lock validation checks passed');
