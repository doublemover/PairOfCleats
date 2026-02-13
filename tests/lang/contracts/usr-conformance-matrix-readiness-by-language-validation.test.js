#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../runner/run-config.js';
import { resolveConformanceLaneId } from '../../../src/contracts/validators/conformance-lanes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const conformanceLevelsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-conformance-levels.json');

const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const conformanceLevels = JSON.parse(fs.readFileSync(conformanceLevelsPath, 'utf8'));

const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];
const conformanceRows = (Array.isArray(conformanceLevels.rows) ? conformanceLevels.rows : [])
  .filter((row) => row.profileType === 'language');

assert.equal(languageRows.length > 0, true, 'language profile registry must contain rows');
assert.equal(conformanceRows.length > 0, true, 'conformance level registry must contain language rows');

const languageIds = new Set(languageRows.map((row) => row.id));
const conformanceByLanguage = new Map();
for (const row of conformanceRows) {
  assert.equal(conformanceByLanguage.has(row.profileId), false, `conformance levels must not contain duplicate language profile rows: ${row.profileId}`);
  conformanceByLanguage.set(row.profileId, row);
}

for (const languageId of languageIds) {
  assert.equal(conformanceByLanguage.has(languageId), true, `language profile is missing conformance-level row: ${languageId}`);
}

for (const row of conformanceRows) {
  assert.equal(languageIds.has(row.profileId), true, `conformance-level row references unknown language profile: ${row.profileId}`);
}

const runRules = loadRunRules({ root: repoRoot });
const conformanceLaneId = resolveConformanceLaneId(Array.from(runRules.knownLanes || []));
assert.equal(Boolean(conformanceLaneId), true, 'conformance lane must be discoverable from run rules');
const supportedConformanceLevels = new Set(['C0', 'C1', 'C2', 'C3', 'C4']);

for (const languageRow of languageRows) {
  const conformanceRow = conformanceByLanguage.get(languageRow.id);
  const requiredLevels = [...new Set(conformanceRow.requiredLevels || [])].sort();
  const blockingLevels = [...new Set(conformanceRow.blockingLevels || [])].sort();
  const profileRequiredLevels = [...new Set(languageRow.requiredConformance || [])].sort();
  const requiredFixtureFamilies = new Set(conformanceRow.requiredFixtureFamilies || []);

  assert.deepEqual(requiredLevels, profileRequiredLevels, `language conformance required levels must match language profile: ${languageRow.id}`);
  assert.deepEqual(blockingLevels, requiredLevels, `language conformance blocking levels must match required levels: ${languageRow.id}`);
  assert.equal(requiredFixtureFamilies.has('golden'), true, `language conformance row must require golden fixtures: ${languageRow.id}`);
  assert.equal(requiredFixtureFamilies.has('normalization'), true, `language conformance row must require normalization fixtures: ${languageRow.id}`);
  assert.equal(requiredFixtureFamilies.has('resolution'), true, `language conformance row must require resolution fixtures: ${languageRow.id}`);

  if (requiredLevels.includes('C3')) {
    assert.equal(requiredFixtureFamilies.has('risk'), true, `C3 language conformance row must require risk fixtures: ${languageRow.id}`);
  }

  const hasFrameworkOverlays = Array.isArray(languageRow.frameworkProfiles) && languageRow.frameworkProfiles.length > 0;
  if (requiredLevels.includes('C4') && hasFrameworkOverlays) {
    assert.equal(requiredFixtureFamilies.has('framework-overlay'), true, `C4 language conformance row with framework overlays must require framework-overlay fixtures: ${languageRow.id}`);
  }

  for (const level of requiredLevels) {
    assert.equal(supportedConformanceLevels.has(level), true, `language conformance row contains unsupported level ${level}: ${languageRow.id}`);
  }
}

console.log('usr conformance matrix readiness by-language validation checks passed');
