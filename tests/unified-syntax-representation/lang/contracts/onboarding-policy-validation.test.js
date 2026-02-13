#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const onboardingPath = path.join(repoRoot, 'docs', 'guides', 'usr-new-language-onboarding.md');
const onboardingText = fs.readFileSync(onboardingPath, 'utf8');

const requiredRefs = [
  'src/index/language-registry/registry-data.js',
  'docs/specs/usr-core-language-framework-catalog.md',
  'docs/specs/usr-core-normalization-linking-identity.md',
  'docs/specs/usr-core-security-risk-compliance.md',
  'docs/specs/usr-core-quality-conformance-testing.md',
  'tests/lang/matrix/usr-language-profiles.json',
  'tests/lang/matrix/usr-language-version-policy.json',
  'tests/lang/matrix/usr-language-embedding-policy.json',
  'tests/lang/matrix/usr-capability-matrix.json'
];

for (const ref of requiredRefs) {
  assert.equal(onboardingText.includes(`\`${ref}\``), true, `onboarding guide missing required reference: ${ref}`);
  const fullPath = path.join(repoRoot, ref.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(fullPath), true, `onboarding guide reference path missing: ${ref}`);
}

assert.equal(/`supported`, `partial`, or `unsupported`/i.test(onboardingText), true, 'onboarding guide must require explicit capability state declarations');
assert.equal(/framework interop expectations/i.test(onboardingText), true, 'onboarding guide must require framework interop expectations');
assert.equal(/route\/template\/style canonicalization obligations/i.test(onboardingText), true, 'onboarding guide must require route/template/style canonicalization obligations for applicable framework overlays');
assert.equal(/## Required fixture ID mappings/i.test(onboardingText), true, 'onboarding guide must require per-language fixture ID mapping section');
assert.equal(/## Approval checklist/i.test(onboardingText), true, 'onboarding guide must require per-language approval checklist section');
assert.equal(/## Completion evidence artifacts/i.test(onboardingText), true, 'onboarding guide must require per-language completion evidence artifact section');

console.log('usr onboarding policy validation checks passed');
