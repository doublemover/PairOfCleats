#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const rolloutSpecPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-rollout-release-migration.md');
const runtimeConfigPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-runtime-config-policy.json');
const operationalReadinessPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-operational-readiness-policy.json');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const rolloutSpecText = fs.readFileSync(rolloutSpecPath, 'utf8');
const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf8'));
const operationalReadiness = JSON.parse(fs.readFileSync(operationalReadinessPath, 'utf8'));
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
  '## Rollback policy',
  '## Required outputs'
];

for (const anchor of requiredSpecAnchors) {
  assert.equal(rolloutSpecText.includes(anchor), true, `rollout/migration spec missing required anchor: ${anchor}`);
}

assert.equal(rolloutSpecText.includes('`tests/lang/matrix/usr-backcompat-matrix.json`'), true, 'rollout spec must reference backcompat matrix artifact');
assert.equal(rolloutSpecText.includes('`usr-operational-readiness-validation.json`'), true, 'rollout spec must require operational readiness report output');
assert.equal(rolloutSpecText.includes('`usr-backcompat-matrix-results.json`'), true, 'rollout spec must require backcompat results output');

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
  'lang/contracts/usr-runtime-config-feature-flag-validation',
  'lang/contracts/usr-implementation-readiness-validation',
  'backcompat/backcompat-matrix-validation'
];

for (const testId of requiredCiTests) {
  assert.equal(ciOrderText.includes(testId), true, `ci order missing rollout/migration validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing rollout/migration validator: ${testId}`);
}

console.log('usr rollout/migration policy validation checks passed');
