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

const requiredCiTests = [
  'lang/contracts/usr-contract-enforcement',
  'lang/contracts/usr-roadmap-sync',
  'lang/contracts/usr-pr-template-policy-validation',
  'lang/contracts/usr-language-contract-freshness-validation',
  'lang/contracts/usr-runtime-config-feature-flag-validation',
  'lang/contracts/usr-failure-injection-validation',
  'lang/contracts/usr-fixture-governance-validation',
  'lang/contracts/usr-benchmark-policy-validation',
  'lang/contracts/usr-threat-model-coverage-validation',
  'lang/contracts/usr-waiver-policy-validation',
  'lang/contracts/usr-report-envelope-validation'
];

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order must include maintenance control validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order must include maintenance control validator: ${testId}`);
}

const requiredPrMarkers = [
  'usr-policy:change-control',
  'usr-policy:decomposed-workflow',
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
