#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const fixtureGovernance = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-fixture-governance.json'), 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-language-profiles.json'), 'utf8'));
const frameworkProfiles = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-framework-profiles.json'), 'utf8'));

const fixtureRows = Array.isArray(fixtureGovernance.rows) ? fixtureGovernance.rows : [];
const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];
const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];

const blockingRows = fixtureRows.filter((row) => row.blocking === true);
assert.equal(blockingRows.length > 0, true, 'fixture governance must contain blocking rows');

for (const language of languageRows) {
  const rows = blockingRows.filter((row) => row.profileType === 'language' && row.profileId === language.id);
  assert.equal(rows.length > 0, true, `language must have blocking fixture evidence rows: ${language.id}`);
  assert.equal(rows.some((row) => row.goldenRequired === true), true, `language must have at least one goldenRequired fixture: ${language.id}`);
}

for (const framework of frameworkRows) {
  const rows = blockingRows.filter((row) => row.profileType === 'framework' && row.profileId === framework.id);
  assert.equal(rows.length > 0, true, `framework must have blocking fixture evidence rows: ${framework.id}`);
  assert.equal(rows.some((row) => row.goldenRequired === true), true, `framework must have at least one goldenRequired fixture: ${framework.id}`);
}

const ciOrderText = fs.readFileSync(path.join(repoRoot, 'tests', 'ci', 'ci.order.txt'), 'utf8');
const ciLiteOrderText = fs.readFileSync(path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt'), 'utf8');
for (const testId of [
  'lang/contracts/usr-fixture-governance-coverage-floor-validation',
  'lang/contracts/usr-canonical-example-validation',
  'lang/contracts/usr-cross-language-canonical-bundle-coherence-validation',
  'lang/contracts/usr-framework-canonicalization',
  'lang/contracts/usr-embedding-bridge-validation',
  'lang/contracts/usr-generated-provenance-validation'
]) {
  assert.equal(ciOrderText.includes(testId), true, `ci lane missing fixture/golden readiness validator: ${testId}`);
  assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite lane missing fixture/golden readiness validator: ${testId}`);
}

for (const relativePath of [
  'tests/fixtures/usr/canonical-examples/usr-canonical-example-bundle.json',
  'tests/fixtures/usr/framework-canonicalization/usr-framework-canonicalization-bundle.json',
  'tests/fixtures/usr/embedding-bridges/usr-embedding-bridge-bundle.json',
  'tests/fixtures/usr/generated-provenance/usr-generated-provenance-bundle.json'
]) {
  const raw = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const parsedA = JSON.parse(raw);
  const parsedB = JSON.parse(raw);
  const digestA = sha1(stableStringify(parsedA));
  const digestB = sha1(stableStringify(parsedB));
  assert.equal(digestA, digestB, `golden fixture serialization must be deterministic: ${relativePath}`);
}

console.log('usr fixture/golden readiness validation checks passed');
