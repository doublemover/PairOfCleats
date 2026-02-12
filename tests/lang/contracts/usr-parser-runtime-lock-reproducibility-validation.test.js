#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const parserRuntimeLockPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-parser-runtime-lock.json');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');

const parserRuntimeLock = JSON.parse(fs.readFileSync(parserRuntimeLockPath, 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));

const lockRows = Array.isArray(parserRuntimeLock.rows) ? parserRuntimeLock.rows : [];
const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];
const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];

assert.equal(lockRows.length > 0, true, 'parser-runtime-lock matrix must contain rows');

const sortedRows = [...lockRows].sort((a, b) => {
  if (a.parserSource !== b.parserSource) return a.parserSource.localeCompare(b.parserSource);
  return a.languageId.localeCompare(b.languageId);
});
assert.deepEqual(lockRows, sortedRows, 'parser-runtime-lock rows must be deterministically sorted by parserSource/languageId');

const keySet = new Set();
for (const row of lockRows) {
  const key = `${row.parserSource}::${row.languageId}`;
  assert.equal(keySet.has(key), false, `parser-runtime-lock rows must be unique by parserSource/languageId: ${key}`);
  keySet.add(key);

  assert.equal(typeof row.lockReason === 'string' && row.lockReason.trim().length > 0, true, `parser-runtime-lock row lockReason must be non-empty: ${row.parserSource}`);
  assert.equal(Number.isInteger(row.maxUpgradeBudgetDays), true, `parser-runtime-lock maxUpgradeBudgetDays must be integer: ${row.parserSource}`);
  assert.equal(row.maxUpgradeBudgetDays >= 7, true, `parser-runtime-lock maxUpgradeBudgetDays must be >= 7: ${row.parserSource}`);
  assert.equal(row.maxUpgradeBudgetDays <= 180, true, `parser-runtime-lock maxUpgradeBudgetDays must be <= 180: ${row.parserSource}`);
}

const lockedParserSources = new Set(lockRows.map((row) => row.parserSource));
const expectedParserSources = new Set();
const runtimeParserSourceAllowlist = new Set([
  'framework-compiler',
  'heuristic',
  'hybrid',
  'native-parser',
  'tooling',
  'tree-sitter'
]);

for (const row of languageRows) {
  if (typeof row.parserPreference === 'string' && row.parserPreference.length > 0) {
    expectedParserSources.add(row.parserPreference);
  }
  for (const parserSource of row.fallbackChain || []) {
    expectedParserSources.add(parserSource);
  }
}

for (const row of frameworkRows) {
  for (const parserSource of row.detectionPrecedence || []) {
    if (runtimeParserSourceAllowlist.has(parserSource)) {
      expectedParserSources.add(parserSource);
    }
  }
}

for (const parserSource of expectedParserSources) {
  assert.equal(lockedParserSources.has(parserSource), true, `parser-runtime-lock missing coverage for referenced parser source: ${parserSource}`);
}

for (const requiredBudgetSource of ['native-parser', 'tree-sitter']) {
  const sourceRows = lockRows.filter((row) => row.parserSource === requiredBudgetSource);
  assert.equal(sourceRows.length > 0, true, `parser-runtime-lock missing required source for budget policy: ${requiredBudgetSource}`);
  assert.equal(sourceRows.every((row) => row.maxUpgradeBudgetDays <= 45), true, `${requiredBudgetSource} lock rows must use <= 45 day upgrade budget`);
}

console.log('usr parser-runtime-lock reproducibility validation checks passed');
