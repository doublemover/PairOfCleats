#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const matrixPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix.js');
const indexPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'index.js');
const registryPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'registry.js');
const runtimePath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'runtime.js');
const scenariosPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'scenarios.js');
const benchmarkPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'benchmark.js');
const observabilitySecurityPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'observability-security.js');
const readinessPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'readiness.js');
const governancePath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'governance.js');
const runtimeConfigPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'runtime-config.js');
const profileHelpersPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'profile-helpers.js');
const observabilityHelpersPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'observability-helpers.js');
const reportShapingPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'report-shaping.js');

for (const target of [
  matrixPath,
  indexPath,
  registryPath,
  runtimePath,
  scenariosPath,
  benchmarkPath,
  observabilitySecurityPath,
  readinessPath,
  governancePath,
  runtimeConfigPath,
  profileHelpersPath,
  observabilityHelpersPath,
  reportShapingPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected usr-matrix modularization file: ${target}`);
}

const source = fs.readFileSync(matrixPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');

for (const marker of [
  "export * from './usr-matrix/index.js';"
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected usr-matrix validator to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'export function validateUsrRuntimeConfigResolution(',
  'export function validateUsrFailureInjectionScenarios(',
  'export function validateUsrBenchmarkMethodology(',
  'export function evaluateUsrObservabilityRollup(',
  'export function validateUsrEmbeddingBridgeCoverage(',
  'export function validateUsrWaiverPolicyControls('
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected usr-matrix validator to stop inlining ${legacyInlineMarker}`
  );
}

for (const marker of [
  "export * from './registry.js';",
  "export * from './runtime.js';",
  "export * from './scenarios.js';",
  "export * from './benchmark.js';",
  "export * from './observability-security.js';",
  "export * from './readiness.js';",
  "export * from './governance.js';"
]) {
  assert.equal(
    indexSource.includes(marker),
    true,
    `expected usr-matrix index barrel to export ${marker}`
  );
}

console.log('USR matrix modularization test passed');
