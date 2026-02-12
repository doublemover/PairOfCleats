#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const languageDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');

const requiredSections = [
  '## Scope',
  '## Machine-readable linkage',
  '## Required conformance levels',
  '## Required framework profiles',
  '## Required node kinds',
  '## Required edge kinds',
  '## Capability baseline',
  '## Change control',
  '## Approval checklist',
  '## Completion evidence artifacts'
];

for (const row of languageProfiles.rows || []) {
  const languageId = row.id;
  const docPath = path.join(languageDocDir, `${languageId}.md`);
  assert.equal(fs.existsSync(docPath), true, `missing language contract doc: ${languageId}`);

  const text = fs.readFileSync(docPath, 'utf8');
  assert.equal(text.startsWith(`# USR Language Contract: ${languageId}`), true, `language contract title mismatch: ${languageId}`);

  for (const section of requiredSections) {
    assert.equal(text.includes(section), true, `language contract missing section (${languageId}): ${section}`);
  }

  assert.equal(text.includes('tests/lang/matrix/usr-language-profiles.json'), true, `language contract must reference usr-language-profiles matrix: ${languageId}`);
  assert.equal(text.includes('tests/lang/matrix/usr-language-version-policy.json'), true, `language contract must reference usr-language-version-policy matrix: ${languageId}`);
  assert.equal(text.includes('tests/lang/matrix/usr-language-embedding-policy.json'), true, `language contract must reference usr-language-embedding-policy matrix: ${languageId}`);

  for (const checklistLine of [
    '- [ ] Owner-role review completed.',
    '- [ ] Backup-owner review completed.',
    '- [ ] Matrix linkage verified against language/version/embedding registries.',
    '- [ ] Required fixture families assigned with concrete fixture IDs.',
    '- [ ] Required conformance levels mapped to executable lanes.'
  ]) {
    assert.equal(text.includes(checklistLine), true, `language contract missing approval checklist item (${languageId}): ${checklistLine}`);
  }

  for (const evidenceArtifact of [
    '`usr-conformance-summary.json`',
    '`usr-quality-evaluation-results.json`',
    '`usr-validation-report.json`',
    '`usr-drift-report.json`'
  ]) {
    assert.equal(text.includes(evidenceArtifact), true, `language contract missing completion evidence artifact (${languageId}): ${evidenceArtifact}`);
  }
}

console.log('usr language contract template checks passed');
