#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const getSectionForMarker = (text, marker, markerList, templateLabel) => {
  const token = `<!-- ${marker} -->`;
  const start = text.indexOf(token);
  assert.notEqual(start, -1, `${templateLabel} missing marker: ${marker}`);

  const duplicate = text.indexOf(token, start + token.length);
  assert.equal(duplicate, -1, `${templateLabel} marker must be unique: ${marker}`);

  const nextOffsets = markerList
    .filter((nextMarker) => nextMarker !== marker)
    .map((nextMarker) => text.indexOf(`<!-- ${nextMarker} -->`, start + token.length))
    .filter((offset) => offset !== -1);

  const end = nextOffsets.length > 0 ? Math.min(...nextOffsets) : text.length;
  return text.slice(start, end);
};

const validateTemplatePolicies = ({ templateLabel, templatePath, requiredHeader, policyRows }) => {
  const templateText = fs.readFileSync(templatePath, 'utf8');
  assert.equal(templateText.includes(requiredHeader), true, `${templateLabel} must include section header: ${requiredHeader}`);

  const allMarkers = policyRows.map((row) => row.marker);
  for (const row of policyRows) {
    const section = getSectionForMarker(templateText, row.marker, allMarkers, templateLabel);
    assert.match(section, /- \[ \] /, `${templateLabel} marker must be followed by a checklist item: ${row.marker}`);

    for (const requiredRef of row.requiredRefs || []) {
      assert.equal(section.includes(`\`${requiredRef}\``), true, `${templateLabel} marker section missing reference: ${row.marker} -> ${requiredRef}`);
    }

    for (const requiredFragment of row.requiredFragments || []) {
      assert.equal(section.toLowerCase().includes(requiredFragment.toLowerCase()), true, `${templateLabel} marker section missing required fragment: ${row.marker} -> ${requiredFragment}`);
    }
  }

  const templateRefs = new Set(
    [...templateText.matchAll(/`((?:docs|tests|src)\/[^`]+?|TES_LAYN_ROADMAP\.md)`/g)].map((match) => match[1])
  );

  for (const ref of templateRefs) {
    if (ref.includes('*')) continue;
    const fullPath = path.join(repoRoot, ref.replace(/\//g, path.sep));
    assert.equal(fs.existsSync(fullPath), true, `${templateLabel} reference path missing: ${ref}`);
  }
};

validateTemplatePolicies({
  templateLabel: 'PR template',
  templatePath: path.join(repoRoot, '.github', 'pull_request_template.md'),
  requiredHeader: '## USR Change Control',
  policyRows: [
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
      marker: 'usr-policy:change-tiering',
      requiredRefs: [
        'docs/specs/usr-core-governance-change.md'
      ],
      requiredFragments: [
        'Tier 1',
        'Tier 2',
        'Tier 3',
        'reviewer threshold',
        'registry/schema/test updates'
      ]
    },
    {
      marker: 'usr-policy:extension-policy',
      requiredRefs: [
        'docs/specs/unified-syntax-representation.md'
      ],
      requiredFragments: [
        'namespaced extension keys',
        'no canonical required-semantic overrides',
        'deterministic extension output ordering/values'
      ]
    },
    {
      marker: 'usr-policy:appendix-sync',
      requiredRefs: [
        'TES_LAYN_ROADMAP.md',
        'docs/specs/usr-consolidation-coverage-matrix.md'
      ]
    },
    {
      marker: 'usr-policy:deprecation-archive',
      requiredRefs: [
        'docs/archived/README.md'
      ],
      requiredFragments: [
        'DEPRECATED header',
        'canonical replacement',
        'reason',
        'date',
        'PR/commit'
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
  ]
});

validateTemplatePolicies({
  templateLabel: 'Release template',
  templatePath: path.join(repoRoot, '.github', 'release_template.md'),
  requiredHeader: '## USR Release Governance',
  policyRows: [
    {
      marker: 'usr-policy:waiver-governance-release',
      requiredRefs: [
        'tests/lang/matrix/usr-waiver-policy.json',
        'docs/specs/usr-core-evidence-gates-waivers.md'
      ],
      requiredFragments: [
        'expiry cadence'
      ]
    }
  ]
});

console.log('usr PR/release template policy validation checks passed');
