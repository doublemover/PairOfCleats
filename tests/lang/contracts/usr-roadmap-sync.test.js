#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const roadmapText = fs.readFileSync(roadmapPath, 'utf8');

const docRefRegex = /`((?:docs|tests)\/[^`]+?)`/g;
const missing = [];
const seen = new Set();

for (const match of roadmapText.matchAll(docRefRegex)) {
  const rel = match[1];
  if (rel.includes('*')) continue;
  // Ignore template placeholders used in roadmap prose.
  if (rel.includes('<') || rel.includes('>')) continue;
  if (!rel.endsWith('.md') && !rel.endsWith('.json') && !rel.endsWith('.js') && !rel.endsWith('.mjs')) continue;
  if (seen.has(rel)) continue;
  seen.add(rel);
  const fullPath = path.join(repoRoot, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(fullPath)) missing.push(rel);
}

assert.equal(missing.length, 0, `missing roadmap references:\n${missing.join('\n')}`);

const requiredSyncDocs = [
  'docs/specs/usr-consolidation-coverage-matrix.md',
  'docs/specs/usr-core-artifact-schema-catalog.md',
  'docs/specs/usr-core-language-framework-catalog.md',
  'docs/specs/usr-core-normalization-linking-identity.md',
  'docs/specs/usr-core-security-risk-compliance.md',
  'docs/specs/usr-core-observability-performance-ops.md',
  'docs/guides/usr-contract-enforcement.md',
  'docs/specs/usr/minimum-slice/typescript-vue.md'
];

for (const rel of requiredSyncDocs) {
  const fullPath = path.join(repoRoot, rel.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(fullPath), true, `required sync document missing: ${rel}`);
}

const extractDocRefs = (text) => new Set(
  [...text.matchAll(docRefRegex)].map((match) => match[1])
);

const decomposedContractRefs = [
  {
    doc: 'docs/specs/usr-core-artifact-schema-catalog.md',
    requiredRefs: [
      'docs/specs/unified-syntax-representation.md',
      'docs/specs/usr-core-evidence-gates-waivers.md',
      'docs/schemas/usr/README.md'
    ]
  },
  {
    doc: 'docs/specs/usr-core-governance-change.md',
    requiredRefs: [
      'docs/specs/usr-consolidation-coverage-matrix.md',
      'docs/specs/usr-core-rollout-release-migration.md'
    ]
  },
  {
    doc: 'docs/specs/usr-core-language-framework-catalog.md',
    requiredRefs: [
      'docs/specs/unified-syntax-representation.md',
      'tests/lang/matrix/usr-language-profiles.json',
      'tests/lang/matrix/usr-framework-profiles.json'
    ]
  },
  {
    doc: 'docs/specs/usr-core-diagnostics-reasoncodes.md',
    requiredRefs: [
      'docs/specs/unified-syntax-representation.md',
      'docs/specs/usr-core-evidence-gates-waivers.md'
    ]
  }
];

for (const contract of decomposedContractRefs) {
  const docPath = path.join(repoRoot, contract.doc.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(docPath), true, `decomposed contract doc missing: ${contract.doc}`);
  const text = fs.readFileSync(docPath, 'utf8');
  const refs = extractDocRefs(text);
  for (const requiredRef of contract.requiredRefs) {
    assert.equal(refs.has(requiredRef), true, `decomposed contract reference missing: ${contract.doc} -> ${requiredRef}`);
    const refPath = path.join(repoRoot, requiredRef.replace(/\//g, path.sep));
    assert.equal(fs.existsSync(refPath), true, `decomposed contract reference path missing: ${requiredRef}`);
  }
}

// Governance lock appendix and decomposed CI-gate mapping anchors must remain present.
const requiredRoadmapAnchors = [
  '## Appendix N - Phase 0 Governance Lock Artifacts',
  '### N.1 USR section-to-task traceability anchors (sections 5 through 36)',
  '### N.2 Section-group ownership and escalation mapping',
  '### N.3 Batch ownership map',
  '### N.4 Contract conflict escalation path',
  '### N.5 Planning guardrails and evidence policy',
  '### N.6 Roadmap edit invariants',
  '| Consolidated contract | Primary intent | Required phases | Required CI gates/lanes |',
  'appendices H/J/M/N'
];

for (const anchor of requiredRoadmapAnchors) {
  assert.equal(roadmapText.includes(anchor), true, `roadmap missing governance/decomposition anchor: ${anchor}`);
}

const requiredGovernanceRefs = [
  'tests/lang/matrix/usr-ownership-matrix.json',
  'tests/lang/matrix/usr-escalation-policy.json',
  'src/index/language-registry/registry-data.js'
];

for (const ref of requiredGovernanceRefs) {
  assert.equal(roadmapText.includes(`\`${ref}\``), true, `roadmap missing required governance reference: ${ref}`);
}

console.log('usr roadmap sync checks passed');
