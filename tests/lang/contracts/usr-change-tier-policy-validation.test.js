#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const governancePath = path.join(repoRoot, 'docs', 'specs', 'usr-core-governance-change.md');
const prTemplatePath = path.join(repoRoot, '.github', 'pull_request_template.md');

const governanceText = fs.readFileSync(governancePath, 'utf8');
const prTemplateText = fs.readFileSync(prTemplatePath, 'utf8');

assert.equal(governanceText.includes('## Tiered change workflow (Tier 1, Tier 2, Tier 3)'), true, 'governance contract must define Tier 1/2/3 change workflow');
assert.equal(governanceText.includes('| Tier | Typical scope | Required reviewer threshold | Required updates |'), true, 'governance contract must include tier reviewer/update threshold matrix');

const requiredGovernanceFragments = [
  '| Tier 1 |',
  '| Tier 2 |',
  '| Tier 3 |',
  'at least 1 owner-role reviewer',
  'at least 2 reviewers including primary or backup owner role',
  'at least 3 reviewers including primary + backup owner roles and release authority',
  'Tier 2 and Tier 3 changes must include synchronized updates to registries, schemas, and tests',
  'Tier 2 and Tier 3 changes must rerun and attach relevant `ci-lite`/`ci` contract evidence',
  'Tier 3 changes must include explicit backcompat and release-readiness evidence updates'
];

for (const fragment of requiredGovernanceFragments) {
  assert.equal(governanceText.includes(fragment), true, `governance contract missing required tier-policy fragment: ${fragment}`);
}

assert.equal(prTemplateText.includes('<!-- usr-policy:change-tiering -->'), true, 'PR template must include change-tiering policy marker');
assert.equal(prTemplateText.includes('`docs/specs/usr-core-governance-change.md`'), true, 'PR template tiering checklist must reference governance contract');
assert.equal(/Tier 1\s*\/\s*Tier 2\s*\/\s*Tier 3/.test(prTemplateText), true, 'PR template tiering checklist must require explicit tier classification');

console.log('usr change-tier policy validation checks passed');
