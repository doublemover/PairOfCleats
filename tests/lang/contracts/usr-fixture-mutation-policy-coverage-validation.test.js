#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const rows = Array.isArray(fixtureGovernance.rows) ? fixtureGovernance.rows : [];

assert.equal(rows.length > 0, true, 'fixture-governance matrix must contain rows');

const policyClasses = ['require-rfc', 'require-review', 'allow-generated-refresh'];
const rowsByPolicy = new Map(policyClasses.map((policy) => [policy, []]));

for (const row of rows) {
  assert.equal(policyClasses.includes(row.mutationPolicy), true, `fixture row has unsupported mutationPolicy: ${row.fixtureId}`);
  rowsByPolicy.get(row.mutationPolicy).push(row);
}

for (const policy of policyClasses) {
  assert.equal(rowsByPolicy.get(policy).length > 0, true, `fixture-governance matrix must include mutationPolicy coverage: ${policy}`);
}

const allowGeneratedRows = rowsByPolicy.get('allow-generated-refresh');
assert.equal(allowGeneratedRows.every((row) => row.blocking !== true), true, 'allow-generated-refresh rows must not be blocking');

const baselineRows = rows.filter((row) => (
  row.fixtureId.endsWith('::baseline::coverage-001')
  || row.fixtureId.endsWith('::framework-overlay::baseline-001')
));
assert.equal(baselineRows.length > 0, true, 'fixture-governance matrix must include baseline coverage fixture rows');
for (const row of baselineRows) {
  assert.equal(row.mutationPolicy, 'require-review', `baseline fixture rows must use mutationPolicy=require-review: ${row.fixtureId}`);
}

const requireRfcRows = rowsByPolicy.get('require-rfc');
assert.equal(
  requireRfcRows.every((row) => Array.isArray(row.reviewers) && row.reviewers.some((reviewer) => reviewer === 'usr-architecture' || reviewer === 'usr-conformance')),
  true,
  'require-rfc rows must include usr-architecture or usr-conformance reviewer coverage'
);

console.log('usr fixture mutation-policy coverage validation checks passed');
