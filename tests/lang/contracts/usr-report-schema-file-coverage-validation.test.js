#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUsrReportIds } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const schemaDir = path.join(repoRoot, 'docs', 'schemas', 'usr');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const requiredTestId = 'lang/contracts/usr-report-schema-file-coverage-validation';
assert.equal(ciOrderText.includes(requiredTestId), true, `ci order missing report schema file coverage validator: ${requiredTestId}`);
assert.equal(ciLiteOrderText.includes(requiredTestId), true, `ci-lite order missing report schema file coverage validator: ${requiredTestId}`);

const reportIds = new Set(listUsrReportIds());
const schemaFiles = fs.readdirSync(schemaDir)
  .filter((name) => name.endsWith('.schema.json') && name !== 'evidence-envelope.schema.json');

const schemaArtifactIds = new Set(schemaFiles.map((name) => name.replace(/\.schema\.json$/, '')));

for (const artifactId of reportIds) {
  assert.equal(schemaArtifactIds.has(artifactId), true, `registered report validator missing schema file in docs/schemas/usr: ${artifactId}.schema.json`);
}

for (const artifactId of schemaArtifactIds) {
  assert.equal(reportIds.has(artifactId), true, `schema file has no registered report validator: ${artifactId}.schema.json`);
}

for (const schemaFile of schemaFiles) {
  const schemaPath = path.join(schemaDir, schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const expectedId = `usr/${schemaFile}`;
  assert.equal(schema.$id, expectedId, `schema $id must match file path: ${schemaFile}`);
}

console.log('usr report schema file coverage validation checks passed');
