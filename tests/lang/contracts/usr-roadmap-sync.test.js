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

console.log('usr roadmap sync checks passed');
