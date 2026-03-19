#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const matrixPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix.js');
const runtimeConfigPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'runtime-config.js');
const profileHelpersPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'profile-helpers.js');
const observabilityHelpersPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'observability-helpers.js');
const reportShapingPath = path.join(root, 'src', 'contracts', 'validators', 'usr-matrix', 'report-shaping.js');

for (const target of [matrixPath, runtimeConfigPath, profileHelpersPath, observabilityHelpersPath, reportShapingPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected usr-matrix modularization file: ${target}`);
}

const source = fs.readFileSync(matrixPath, 'utf8');

for (const marker of [
  "./usr-matrix/runtime-config.js",
  "./usr-matrix/profile-helpers.js",
  "./usr-matrix/observability-helpers.js",
  "./usr-matrix/report-shaping.js",
  'applyRuntimeOverride(',
  'buildBatchObservabilityHotspotRows(',
  'normalizeObservedResultMap(',
  'normalizeReportScope('
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected usr-matrix validator to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const coerceRuntimeConfigValue = (row, rawValue) => {',
  'const compareByOperator = ({ left, operator, right }) => {',
  'const normalizeObservedResultMap = (observedResults, keyField = \'id\') => {',
  'const normalizeReportScope = (scope, fallbackScopeType = \'lane\', fallbackScopeId = \'ci\') => ('
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected usr-matrix validator to stop inlining ${legacyInlineMarker}`
  );
}

console.log('USR matrix modularization test passed');
