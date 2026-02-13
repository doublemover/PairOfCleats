#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const languageDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');

const languageIds = new Set((languageProfiles.rows || []).map((row) => row.id));
const languageDocs = fs.readdirSync(languageDocDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== 'TEMPLATE.md');

for (const fileName of languageDocs) {
  const languageId = fileName.replace(/\.md$/, '');
  assert.equal(languageIds.has(languageId), true, `language contract file has unknown language ID: ${languageId}`);
}

const requiredSections = [
  '## Scope',
  '## Machine-readable linkage',
  '## Required conformance levels',
  '## Required framework profiles',
  '## Required node kinds',
  '## Required edge kinds',
  '## Capability baseline',
  '## Change control',
  '## Required fixture ID mappings',
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

  const fixtureMappingSectionStart = text.indexOf('## Required fixture ID mappings');
  assert.notEqual(fixtureMappingSectionStart, -1, `language contract missing fixture ID mapping section: ${languageId}`);
  const fixtureMappingSectionEnd = text.indexOf('\n## ', fixtureMappingSectionStart + 1);
  const fixtureMappingSection = fixtureMappingSectionEnd === -1
    ? text.slice(fixtureMappingSectionStart)
    : text.slice(fixtureMappingSectionStart, fixtureMappingSectionEnd);
  assert.equal(/`[^`]+`/.test(fixtureMappingSection), true, `language contract fixture ID mapping section must include at least one fixture ID: ${languageId}`);

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
