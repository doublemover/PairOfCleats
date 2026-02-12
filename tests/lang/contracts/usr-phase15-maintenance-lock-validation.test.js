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
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');


const phase153Section = extractSection(roadmapText, '### 15.3 Maintenance', '### 15.4 Exit criteria');
const phase154Section = extractSection(roadmapText, '### 15.4 Exit criteria', '---\n\n## Appendix A - USR Spec to Roadmap Traceability');
const phase15Exit = checklistLineState(phase154Section, 'CI and maintenance controls are stable for ongoing development.');

const changeControlLine = checklistLineState(phase153Section, 'Enforce USR spec change-control policy linkage in PR templates.');
const registryDriftLine = checklistLineState(phase153Section, 'Enforce registry drift checks for language/framework profile files.');
const decomposedWorkflowLine = checklistLineState(phase153Section, 'Enforce decomposed contract suite update workflow (`docs/specs/usr/README.md`) in doc-change PR templates.');
const contractFreshnessLine = checklistLineState(phase153Section, 'Enforce per-language contract freshness checks and ownership rotation policy.');
const parserRuntimeLine = checklistLineState(phase153Section, 'Enforce parser/runtime lock update workflow with impact and fallback evidence in PR templates.');
const runtimeConfigLine = checklistLineState(phase153Section, 'Enforce runtime config key and feature-flag policy update workflow in PR templates.');
const failureInjectionLine = checklistLineState(phase153Section, 'Enforce failure-injection matrix update workflow when new blocking failure classes are introduced.');
const fixtureGovernanceLine = checklistLineState(phase153Section, 'Enforce fixture-governance owner/reviewer coverage checks for new blocking fixtures.');
const benchmarkLine = checklistLineState(phase153Section, 'Enforce benchmark policy update workflow when SLO or lane thresholds change.');
const threatModelLine = checklistLineState(phase153Section, 'Enforce threat-model matrix update workflow when new security gates or attack surfaces are added.');
const waiverLine = checklistLineState(phase153Section, 'Enforce waiver-policy update workflow and expiry review cadence in PR/release templates.');

if (changeControlLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-pr-template-policy-validation',
      'lang/contracts/usr-change-tier-policy-validation'
    ],
    'phase 15.3 change-control lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (registryDriftLine === 'checked') {
  assertTestsPresent(
    ['lang/contracts/usr-contract-enforcement'],
    'phase 15.3 registry-drift lock',
    ciOrderText,
    ciLiteOrderText
  );
  assertTestsPresent(
    ['decomposed-drift/decomposed-drift-validation'],
    'phase 15.3 registry-drift lock',
    ciOrderText,
    ciLiteOrderText,
    { requireCiLite: false }
  );
}

if (decomposedWorkflowLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-pr-template-policy-validation',
      'lang/contracts/usr-f6-sync-requirements-validation'
    ],
    'phase 15.3 decomposed-workflow lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (contractFreshnessLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-language-contract-freshness-validation',
      'lang/contracts/usr-framework-contract-freshness-validation'
    ],
    'phase 15.3 contract-freshness lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (parserRuntimeLine === 'checked') {
  assertTestsPresent(
    ['lang/contracts/usr-parser-runtime-lock-reproducibility-validation'],
    'phase 15.3 parser-runtime lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (runtimeConfigLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-runtime-config-feature-flag-validation',
      'lang/contracts/usr-pr-template-policy-validation'
    ],
    'phase 15.3 runtime-config policy lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (failureInjectionLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-failure-injection-validation',
      'lang/contracts/usr-failure-mode-suite-validation'
    ],
    'phase 15.3 failure-injection workflow lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (fixtureGovernanceLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-fixture-governance-validation',
      'lang/contracts/usr-fixture-governance-coverage-floor-validation'
    ],
    'phase 15.3 fixture-governance lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (benchmarkLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-benchmark-policy-validation',
      'lang/contracts/usr-cross-batch-regression-resolution-validation'
    ],
    'phase 15.3 benchmark-policy lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (threatModelLine === 'checked') {
  assertTestsPresent(
    ['lang/contracts/usr-threat-model-coverage-validation'],
    'phase 15.3 threat-model lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (waiverLine === 'checked') {
  assertTestsPresent(
    [
      'lang/contracts/usr-waiver-policy-validation',
      'lang/contracts/usr-pr-template-policy-validation'
    ],
    'phase 15.3 waiver-policy lock',
    ciOrderText,
    ciLiteOrderText
  );
}

if (hasUnchecked(phase153Section) && phase15Exit === 'checked') {
  assert.fail('phase 15 exit must be reopened when phase 15.3 maintenance prerequisites are not fully checked');
}

for (const fragment of [
  'Phase 15.3 maintenance-integrity lock requirements:',
  '`Enforce USR spec change-control policy linkage in PR templates.` cannot be checked unless PR template policy and change-tier validators remain present in required CI lanes.',
  '`Enforce parser/runtime lock update workflow with impact and fallback evidence in PR templates.` cannot be checked unless parser/runtime lock reproducibility validators remain present in required CI lanes.',
  '`Enforce waiver-policy update workflow and expiry review cadence in PR/release templates.` cannot be checked unless waiver-policy and PR/release template validators remain present in required CI lanes.'
]) {
  assert.equal(rolloutSpecText.includes(fragment), true, `rollout migration contract missing phase-15.3 maintenance lock fragment: ${fragment}`);
}

assert.equal(roadmapText.includes('### N.20 Phase 15.3 maintenance-integrity lock'), true, 'roadmap must include Appendix N.20 phase-15.3 maintenance lock policy');

assertTestsPresent(
  [
    'lang/contracts/usr-phase15-maintenance-lock-validation',
    'lang/contracts/usr-maintenance-controls-stability',
    'lang/contracts/usr-phase15-exit-lock-validation',
    'lang/contracts/usr-pr-template-policy-validation',
    'lang/contracts/usr-rollout-migration-policy-validation'
  ],
  'phase 15.3 maintenance lock umbrella',
  ciOrderText,
  ciLiteOrderText
);

console.log('usr phase 15.3 maintenance lock validation checks passed');
