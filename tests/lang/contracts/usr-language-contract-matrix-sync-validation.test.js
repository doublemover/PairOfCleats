#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const languageDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');

const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));

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

const sortedUnique = (values) => [...new Set(values)].sort();

for (const row of languageProfiles.rows || []) {
  const languageId = row.id;
  const docPath = path.join(languageDocDir, `${languageId}.md`);
  assert.equal(fs.existsSync(docPath), true, `language contract doc missing: ${languageId}`);

  const docText = fs.readFileSync(docPath, 'utf8');

  const conformanceSection = extractSection(docText, 'Required conformance levels');
  const frameworkSection = extractSection(docText, 'Required framework profiles');
  const nodeKindsSection = extractSection(docText, 'Required node kinds');
  const edgeKindsSection = extractSection(docText, 'Required edge kinds');

  const expectedConformance = sortedUnique(row.requiredConformance || []);
  const actualConformance = sortedUnique(extractBacktickedTokens(conformanceSection));
  assert.deepEqual(actualConformance, expectedConformance, `requiredConformance mismatch for ${languageId}`);

  const expectedFrameworks = sortedUnique(row.frameworkProfiles || []);
  const actualFrameworks = sortedUnique(extractBacktickedTokens(frameworkSection));
  if (expectedFrameworks.length === 0) {
    assert.equal(/\bnone\b/i.test(frameworkSection), true, `framework section must declare none for ${languageId}`);
    assert.equal(actualFrameworks.length, 0, `framework section must not include framework IDs for ${languageId}`);
  } else {
    assert.deepEqual(actualFrameworks, expectedFrameworks, `frameworkProfiles mismatch for ${languageId}`);
  }

  const expectedNodeKinds = sortedUnique(row.requiredNodeKinds || []);
  const actualNodeKinds = sortedUnique(extractBacktickedTokens(nodeKindsSection));
  assert.deepEqual(actualNodeKinds, expectedNodeKinds, `requiredNodeKinds mismatch for ${languageId}`);

  const expectedEdgeKinds = sortedUnique(row.requiredEdgeKinds || []);
  const actualEdgeKinds = sortedUnique(extractBacktickedTokens(edgeKindsSection));
  assert.deepEqual(actualEdgeKinds, expectedEdgeKinds, `requiredEdgeKinds mismatch for ${languageId}`);
}

console.log('usr language contract matrix sync validation checks passed');
