#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');

const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));

const fixtureRows = Array.isArray(fixtureGovernance.rows) ? fixtureGovernance.rows : [];
const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];
const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];

const blockingRows = fixtureRows.filter((row) => row.blocking === true);
assert.equal(blockingRows.length > 0, true, 'fixture-governance must include blocking rows');

const groupRows = (profileType) => {
  const grouped = new Map();
  for (const row of blockingRows) {
    if (row.profileType !== profileType) continue;
    if (!grouped.has(row.profileId)) grouped.set(row.profileId, []);
    grouped.get(row.profileId).push(row);
  }
  return grouped;
};

const languageBlockingByProfile = groupRows('language');
const frameworkBlockingByProfile = groupRows('framework');

for (const language of languageRows) {
  const profileRows = languageBlockingByProfile.get(language.id) || [];
  assert.equal(profileRows.length > 0, true, `fixture-governance must include blocking language fixture coverage row(s): ${language.id}`);

  const conformanceCoverage = new Set(profileRows.flatMap((row) => row.conformanceLevels || []));
  for (const level of language.requiredConformance || []) {
    assert.equal(conformanceCoverage.has(level), true, `language fixture coverage must include required conformance level ${level}: ${language.id}`);
  }

  assert.equal(profileRows.some((row) => (row.families || []).includes('golden')), true, `language fixture coverage must include golden family: ${language.id}`);
  assert.equal(profileRows.some((row) => (row.roadmapTags || []).includes(`appendix-c:${language.id}`)), true, `language fixture coverage must include appendix-c roadmap linkage: ${language.id}`);
}

for (const framework of frameworkRows) {
  const profileRows = frameworkBlockingByProfile.get(framework.id) || [];
  assert.equal(profileRows.length > 0, true, `fixture-governance must include blocking framework fixture coverage row(s): ${framework.id}`);

  const conformanceCoverage = new Set(profileRows.flatMap((row) => row.conformanceLevels || []));
  for (const level of framework.requiredConformance || []) {
    assert.equal(conformanceCoverage.has(level), true, `framework fixture coverage must include required conformance level ${level}: ${framework.id}`);
  }

  const familyCoverage = new Set(profileRows.flatMap((row) => row.families || []));
  assert.equal(familyCoverage.has('framework-overlay'), true, `framework fixture coverage must include framework-overlay family: ${framework.id}`);

  const requiredEdgeKinds = new Set(framework?.bindingSemantics?.requiredEdgeKinds || []);
  if (requiredEdgeKinds.has('template_binds') || requiredEdgeKinds.has('template_emits')) {
    assert.equal(familyCoverage.has('template-binding'), true, `framework fixture coverage must include template-binding family: ${framework.id}`);
  }
  if (requiredEdgeKinds.has('style_scopes')) {
    assert.equal(familyCoverage.has('style-scope'), true, `framework fixture coverage must include style-scope family: ${framework.id}`);
  }
  if (requiredEdgeKinds.has('route_maps_to')) {
    assert.equal(familyCoverage.has('route-semantics'), true, `framework fixture coverage must include route-semantics family: ${framework.id}`);
  }
  if (requiredEdgeKinds.has('hydration_boundary')) {
    assert.equal(familyCoverage.has('hydration'), true, `framework fixture coverage must include hydration family: ${framework.id}`);
  }

  assert.equal(profileRows.some((row) => (row.roadmapTags || []).includes(`appendix-d:${framework.id}`)), true, `framework fixture coverage must include appendix-d roadmap linkage: ${framework.id}`);
}

console.log('usr fixture-governance coverage-floor validation checks passed');
