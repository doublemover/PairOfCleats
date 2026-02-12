#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const frameworkDocDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'frameworks');
const ownershipPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-ownership-matrix.json');
const ownershipPayload = JSON.parse(fs.readFileSync(ownershipPath, 'utf8'));

const governanceRow = (ownershipPayload.rows || []).find((row) => row.domain === 'language-framework-catalog');
assert.equal(Boolean(governanceRow), true, 'ownership matrix must include language-framework-catalog governance row');

const expectedOwnerRole = governanceRow.ownerRole;
const expectedBackupOwnerRole = governanceRow.backupOwnerRole;
assert.equal(typeof expectedOwnerRole, 'string', 'ownership row ownerRole must be a string');
assert.equal(typeof expectedBackupOwnerRole, 'string', 'ownership row backupOwnerRole must be a string');

const extractField = (text, fieldName, fileName) => {
  const pattern = new RegExp(`^${fieldName}:\\s+(.+)$`, 'm');
  const match = text.match(pattern);
  assert.notEqual(match, null, `${fileName} missing required field: ${fieldName}`);
  return match[1].trim();
};

const nowMs = Date.now();
const frameworkFiles = fs.readdirSync(frameworkDocDir)
  .filter((fileName) => fileName.endsWith('.md'))
  .filter((fileName) => fileName !== 'README.md' && fileName !== 'TEMPLATE.md');

assert.equal(frameworkFiles.length > 0, true, 'framework contract directory must include framework spec files');

for (const fileName of frameworkFiles) {
  const filePath = path.join(frameworkDocDir, fileName);
  const text = fs.readFileSync(filePath, 'utf8');

  const ownerRole = extractField(text, 'Owner role', fileName);
  const backupOwnerRole = extractField(text, 'Backup owner role', fileName);
  const reviewCadenceRaw = extractField(text, 'Review cadence days', fileName);
  const lastUpdatedRaw = extractField(text, 'Last updated', fileName);
  const lastReviewedRaw = extractField(text, 'Last reviewed', fileName);
  const rotationPolicy = extractField(text, 'Rotation policy', fileName);

  assert.equal(ownerRole, expectedOwnerRole, `${fileName} owner role must match ownership policy for language-framework catalog`);
  assert.equal(backupOwnerRole, expectedBackupOwnerRole, `${fileName} backup owner role must match ownership policy for language-framework catalog`);

  const reviewCadence = Number.parseInt(reviewCadenceRaw, 10);
  assert.equal(Number.isInteger(reviewCadence), true, `${fileName} review cadence must be an integer number of days`);
  assert.equal(reviewCadence > 0, true, `${fileName} review cadence must be greater than zero`);
  assert.equal(reviewCadence <= 365, true, `${fileName} review cadence must be <= 365 days`);

  const lastUpdatedMs = Date.parse(lastUpdatedRaw);
  const lastReviewedMs = Date.parse(lastReviewedRaw);
  assert.equal(Number.isNaN(lastUpdatedMs), false, `${fileName} last updated must be a valid ISO-8601 timestamp`);
  assert.equal(Number.isNaN(lastReviewedMs), false, `${fileName} last reviewed must be a valid ISO-8601 timestamp`);
  assert.equal(lastReviewedMs >= lastUpdatedMs, true, `${fileName} last reviewed must be >= last updated timestamp`);

  const maxAgeMs = reviewCadence * 24 * 60 * 60 * 1000;
  assert.equal(nowMs - lastReviewedMs <= maxAgeMs, true, `${fileName} last reviewed timestamp exceeds review cadence (${reviewCadence} days)`);

  assert.equal(/rotate/i.test(rotationPolicy), true, `${fileName} rotation policy must explicitly require rotation`);
  assert.equal(/review cycle/i.test(rotationPolicy), true, `${fileName} rotation policy must reference the review cycle`);
}

console.log('usr framework contract freshness and ownership rotation checks passed');
