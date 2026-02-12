#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const unifiedSpecPath = path.join(repoRoot, 'docs', 'specs', 'unified-syntax-representation.md');
const prTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
const securityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-security-gates.json');
const threatModelPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-threat-model-matrix.json');

const unifiedSpecText = fs.readFileSync(unifiedSpecPath, 'utf8');
const prTemplateText = fs.readFileSync(prTemplatePath, 'utf8');
const securityGates = JSON.parse(fs.readFileSync(securityGatesPath, 'utf8'));
const threatModel = JSON.parse(fs.readFileSync(threatModelPath, 'utf8'));

const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

const getSectionForMarker = (text, marker) => {
  const markerToken = `<!-- ${marker} -->`;
  const start = text.indexOf(markerToken);
  assert.notEqual(start, -1, `PR template missing marker: ${marker}`);

  const duplicate = text.indexOf(markerToken, start + markerToken.length);
  assert.equal(duplicate, -1, `PR template marker must be unique: ${marker}`);

  const nextMarkerMatch = text.slice(start + markerToken.length).match(/<!-- usr-policy:[a-z0-9-]+ -->/);
  const end = nextMarkerMatch ? start + markerToken.length + nextMarkerMatch.index : text.length;
  return text.slice(start, end);
};

const section29 = extractSection(unifiedSpecText, '## 29. Extension policy', '## 30. Required audit artifacts and reports');

const requiredSection29Fragments = [
  'extensions MUST be namespaced',
  'extensions MUST NOT redefine canonical semantics of required fields',
  'extensions MUST be deterministic',
  'changing canonical ID formation',
  'mutating required enum values',
  'bypassing endpoint constraints',
  'suppressing required diagnostics for downgraded capability states'
];

for (const fragment of requiredSection29Fragments) {
  assert.equal(section29.includes(fragment), true, `USR section 29 missing required extension-policy fragment: ${fragment}`);
}

const extensionPolicyTemplateSection = getSectionForMarker(prTemplateText, 'usr-policy:extension-policy');
assert.equal(extensionPolicyTemplateSection.includes('`docs/specs/unified-syntax-representation.md`'), true, 'extension-policy checklist must reference unified USR spec');

const requiredTemplateFragments = [
  'namespaced extension keys',
  'no canonical required-semantic overrides',
  'deterministic extension output ordering/values'
];

for (const fragment of requiredTemplateFragments) {
  assert.equal(extensionPolicyTemplateSection.toLowerCase().includes(fragment.toLowerCase()), true, `extension-policy checklist missing required fragment: ${fragment}`);
}

const schemaNoExtensionGate = (securityGates.rows || []).find((row) => row.id === 'security-gate-schema-no-extension');
assert.equal(Boolean(schemaNoExtensionGate), true, 'security gate registry must include security-gate-schema-no-extension control');
assert.equal(schemaNoExtensionGate.check, 'strict_schema_unknown_keys_rejected', 'schema no-extension gate must enforce strict unknown-key rejection');
assert.equal(schemaNoExtensionGate.enforcement, 'strict', 'schema no-extension gate must be strict');
assert.equal(schemaNoExtensionGate.blocking, true, 'schema no-extension gate must be blocking');

const schemaConfusionThreat = (threatModel.rows || []).find((row) => row.id === 'threat-schema-confusion');
assert.equal(Boolean(schemaConfusionThreat), true, 'threat model must include schema-confusion scenario');
assert.equal((schemaConfusionThreat.requiredControls || []).includes('security-gate-schema-no-extension'), true, 'schema-confusion threat must require schema no-extension gate');
assert.equal(schemaConfusionThreat.blocking, true, 'schema-confusion threat must remain blocking');

console.log('usr extension policy validation checks passed');
