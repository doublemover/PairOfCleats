#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');
const frameworkDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'frameworks');
const frameworkReadmePath = path.join(frameworkDocDir, 'README.md');
const frameworkTemplatePath = path.join(frameworkDocDir, 'TEMPLATE.md');

const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const frameworkProfileIds = new Set((frameworkProfiles.rows || []).map((row) => row.id));

const requiredTemplateSections = [
  '## 0. Scope',
  '## 1. Detection and precedence',
  '## 2. Segmentation and extraction rules',
  '## 3. Template/binding semantics',
  '## 4. Route semantics',
  '## 5. Style semantics',
  '## 6. SSR/CSR/hydration boundaries',
  '## 7. Risk and diagnostics expectations',
  '## 8. Required fixtures and evidence',
  '## 9. Approval checklist',
  '## 10. Completion evidence artifacts'
];

const templateText = fs.readFileSync(frameworkTemplatePath, 'utf8');
for (const section of requiredTemplateSections) {
  assert.equal(templateText.includes(section), true, `framework template missing required section: ${section}`);
}

for (const line of [
  '- [ ] Owner-role review completed.',
  '- [ ] Backup-owner review completed.',
  '- [ ] Matrix linkage verified against framework profile and edge-case registries.',
  '- [ ] Required framework fixture families assigned with concrete fixture IDs.',
  '- [ ] Required C4 conformance checks mapped to executable lanes.'
]) {
  assert.equal(templateText.includes(line), true, `framework template missing approval checklist line: ${line}`);
}

for (const artifactRef of [
  '`usr-conformance-summary.json`',
  '`usr-quality-evaluation-results.json`',
  '`usr-validation-report.json`',
  '`usr-drift-report.json`'
]) {
  assert.equal(templateText.includes(artifactRef), true, `framework template missing completion-evidence artifact reference: ${artifactRef}`);
}

const readmeText = fs.readFileSync(frameworkReadmePath, 'utf8');
assert.equal(readmeText.includes('docs/specs/usr/frameworks/TEMPLATE.md'), true, 'framework README must reference template path');
assert.equal(/## 9\. Approval checklist/i.test(readmeText), true, 'framework README must require approval checklist section');
assert.equal(/## 10\. Completion evidence artifacts/i.test(readmeText), true, 'framework README must require completion evidence artifacts section');

const frameworkDocs = fs.readdirSync(frameworkDocDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== 'TEMPLATE.md');
const frameworkDocIds = new Set(frameworkDocs.map((name) => name.replace(/\.md$/, '')));

for (const frameworkId of frameworkProfileIds) {
  assert.equal(
    frameworkDocIds.has(frameworkId),
    true,
    `framework profile is missing contract doc: ${frameworkId}`
  );
  assert.equal(
    readmeText.includes(`docs/specs/usr/frameworks/${frameworkId}.md`),
    true,
    `framework README must index framework contract doc: ${frameworkId}`
  );
}

for (const fileName of frameworkDocs) {
  const frameworkId = fileName.replace(/\.md$/, '');
  const docPath = path.join(frameworkDocDir, fileName);
  const text = fs.readFileSync(docPath, 'utf8');

  assert.equal(frameworkProfileIds.has(frameworkId), true, `framework contract file has unknown framework ID: ${frameworkId}`);
  assert.equal(text.startsWith(`# USR Framework Contract: ${frameworkId}`), true, `framework contract title mismatch: ${frameworkId}`);

  for (const section of requiredTemplateSections.slice(1)) {
    assert.equal(text.includes(section), true, `framework contract missing required section (${frameworkId}): ${section}`);
  }
}

console.log('usr framework contract template validation checks passed');
