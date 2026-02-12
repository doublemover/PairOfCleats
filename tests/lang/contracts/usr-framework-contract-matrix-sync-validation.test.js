#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');
const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const frameworkDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'frameworks');

const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));

const extractSection = (text, heading) => {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing section marker: ${marker}`);
  const fromMarker = text.slice(start + marker.length);
  const nextSectionIndex = fromMarker.search(/\n##\s+/);
  return nextSectionIndex === -1 ? fromMarker : fromMarker.slice(0, nextSectionIndex);
};

const extractBacktickedTokens = (text) => {
  const tokens = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    tokens.push(match[1]);
  }
  return tokens;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractLineTokens = (sectionText, key, frameworkId) => {
  const pattern = new RegExp('^-\\s+`' + escapeRegex(key) + '`:\\s+(.+)$', 'm');
  const match = sectionText.match(pattern);
  assert.notEqual(match, null, `missing ${key} line for framework ${frameworkId}`);
  return extractBacktickedTokens(match[1]);
};

const sortedUnique = (values) => [...new Set(values)].sort();

const blockingFixtureIdsByFramework = new Map();
for (const fixtureRow of fixtureGovernance.rows || []) {
  if (fixtureRow.profileType !== 'framework' || fixtureRow.blocking !== true) continue;
  if (!blockingFixtureIdsByFramework.has(fixtureRow.profileId)) blockingFixtureIdsByFramework.set(fixtureRow.profileId, []);
  blockingFixtureIdsByFramework.get(fixtureRow.profileId).push(fixtureRow.fixtureId);
}

for (const row of frameworkProfiles.rows || []) {
  const frameworkId = row.id;
  const docPath = path.join(frameworkDocDir, `${frameworkId}.md`);
  assert.equal(fs.existsSync(docPath), true, `framework contract doc missing: ${frameworkId}`);

  const docText = fs.readFileSync(docPath, 'utf8');

  const detectionSection = extractSection(docText, '1. Detection and precedence');
  const templateBindingSection = extractSection(docText, '3. Template/binding semantics');
  const fixtureEvidenceSection = extractSection(docText, '8. Required fixtures and evidence');

  const expectedAppliesToLanguages = sortedUnique(row.appliesToLanguages || []);
  const actualAppliesToLanguages = sortedUnique(extractLineTokens(detectionSection, 'appliesToLanguages', frameworkId));
  assert.deepEqual(actualAppliesToLanguages, expectedAppliesToLanguages, `appliesToLanguages mismatch for ${frameworkId}`);

  const expectedEdgeKinds = sortedUnique(row?.bindingSemantics?.requiredEdgeKinds || []);
  const actualEdgeKinds = sortedUnique(extractLineTokens(templateBindingSection, 'requiredEdgeKinds', frameworkId));
  assert.deepEqual(actualEdgeKinds, expectedEdgeKinds, `requiredEdgeKinds mismatch for ${frameworkId}`);

  const expectedEdgeCaseIds = sortedUnique(row.edgeCaseCaseIds || []);
  const actualEdgeCaseIds = sortedUnique(extractLineTokens(fixtureEvidenceSection, 'edgeCaseCaseIds', frameworkId));
  assert.deepEqual(actualEdgeCaseIds, expectedEdgeCaseIds, `edgeCaseCaseIds mismatch for ${frameworkId}`);

  const expectedConformance = sortedUnique(row.requiredConformance || []);
  const actualConformance = sortedUnique(extractLineTokens(fixtureEvidenceSection, 'requiredConformance', frameworkId));
  assert.deepEqual(actualConformance, expectedConformance, `requiredConformance mismatch for ${frameworkId}`);

  const expectedFixtureIds = sortedUnique(blockingFixtureIdsByFramework.get(frameworkId) || []);
  assert.equal(expectedFixtureIds.length > 0, true, `blocking framework fixture coverage missing from usr-fixture-governance: ${frameworkId}`);
  const actualFixtureIds = sortedUnique(extractLineTokens(fixtureEvidenceSection, 'blockingFixtureIds', frameworkId));
  assert.deepEqual(actualFixtureIds, expectedFixtureIds, `blocking fixture ID mapping mismatch for ${frameworkId}`);
}

console.log('usr framework contract matrix sync validation checks passed');
