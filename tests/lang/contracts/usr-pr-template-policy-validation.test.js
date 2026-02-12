#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const templatePath = path.join(repoRoot, '.github', 'pull_request_template.md');
const templateText = fs.readFileSync(templatePath, 'utf8');

const getSectionForMarker = (text, marker, markerList) => {
  const token = `<!-- ${marker} -->`;
  const start = text.indexOf(token);
  assert.notEqual(start, -1, `PR template missing marker: ${marker}`);

  const duplicate = text.indexOf(token, start + token.length);
  assert.equal(duplicate, -1, `PR template marker must be unique: ${marker}`);

  const nextOffsets = markerList
    .filter((nextMarker) => nextMarker !== marker)
    .map((nextMarker) => text.indexOf(`<!-- ${nextMarker} -->`, start + token.length))
    .filter((offset) => offset !== -1);

  const end = nextOffsets.length > 0 ? Math.min(...nextOffsets) : text.length;
  return text.slice(start, end);
};

const policyRows = [
  {
    marker: 'usr-policy:change-control',
    requiredRefs: [
      'docs/specs/unified-syntax-representation.md',
      'docs/specs/usr/README.md'
    ]
  },
  {
    marker: 'usr-policy:decomposed-workflow',
    requiredRefs: [
      'docs/specs/usr-consolidation-coverage-matrix.md'
    ]
  },
  {
    marker: 'usr-policy:registry-drift',
    requiredRefs: [
      'docs/specs/usr/languages/*.md',
      'docs/specs/usr/frameworks/*.md'
    ]
  },
  {
    marker: 'usr-policy:parser-lock',
    requiredRefs: [
      'tests/lang/matrix/usr-parser-runtime-lock.json'
    ]
  },
  {
    marker: 'usr-policy:runtime-config',
    requiredRefs: [
      'tests/lang/matrix/usr-runtime-config-policy.json'
    ]
  },
  {
    marker: 'usr-policy:failure-injection',
    requiredRefs: [
      'tests/lang/matrix/usr-failure-injection-matrix.json'
    ]
  },
  {
    marker: 'usr-policy:benchmark-slo',
    requiredRefs: [
      'tests/lang/matrix/usr-benchmark-policy.json',
      'tests/lang/matrix/usr-slo-budgets.json'
    ]
  },
  {
    marker: 'usr-policy:threat-model',
    requiredRefs: [
      'tests/lang/matrix/usr-threat-model-matrix.json',
      'tests/lang/matrix/usr-security-gates.json'
    ]
  },
  {
    marker: 'usr-policy:waiver-governance',
    requiredRefs: [
      'tests/lang/matrix/usr-waiver-policy.json'
    ]
  }
];

assert.equal(templateText.includes('## USR Change Control'), true, 'PR template must include USR change-control section header');

const allMarkers = policyRows.map((row) => row.marker);
for (const row of policyRows) {
  const section = getSectionForMarker(templateText, row.marker, allMarkers);
  assert.match(section, /- \[ \] /, `PR template marker must be followed by a checklist item: ${row.marker}`);
  for (const requiredRef of row.requiredRefs) {
    assert.equal(section.includes(`\`${requiredRef}\``), true, `PR template marker section missing reference: ${row.marker} -> ${requiredRef}`);
  }
}

const templateRefs = new Set(
  [...templateText.matchAll(/`((?:docs|tests|src)\/[^`]+?)`/g)].map((match) => match[1])
);

for (const ref of templateRefs) {
  if (ref.includes('*')) continue;
  const fullPath = path.join(repoRoot, ref.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(fullPath), true, `PR template reference path missing: ${ref}`);
}

console.log('usr PR template policy validation checks passed');
