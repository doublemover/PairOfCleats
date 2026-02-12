#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const schemaDir = path.join(repoRoot, 'docs', 'schemas', 'usr');
const ciOrderPath = path.join(repoRoot, 'tests', 'ci', 'ci.order.txt');
const ciLiteOrderPath = path.join(repoRoot, 'tests', 'ci-lite', 'ci-lite.order.txt');

const ciOrderText = fs.readFileSync(ciOrderPath, 'utf8');
const ciLiteOrderText = fs.readFileSync(ciLiteOrderPath, 'utf8');

const requiredTestId = 'lang/contracts/usr-doc-schema-contract-validation';
assert.equal(ciOrderText.includes(requiredTestId), true, `ci order missing doc schema contract validator: ${requiredTestId}`);
assert.equal(ciLiteOrderText.includes(requiredTestId), true, `ci-lite order missing doc schema contract validator: ${requiredTestId}`);

const envelopePath = path.join(schemaDir, 'evidence-envelope.schema.json');
const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
const envelopeRequired = new Set(Array.isArray(envelope.required) ? envelope.required : []);
for (const field of ['schemaVersion', 'artifactId', 'generatedAt', 'producerId', 'scope', 'runId', 'lane', 'buildId', 'status']) {
  assert.equal(envelopeRequired.has(field), true, `evidence envelope missing required field: ${field}`);
}

const schemaFiles = fs.readdirSync(schemaDir)
  .filter((name) => name.endsWith('.schema.json') && name !== 'evidence-envelope.schema.json');
assert.equal(schemaFiles.length > 0, true, 'USR schema directory must include artifact report schemas');

for (const schemaFile of schemaFiles) {
  const artifactId = schemaFile.replace(/\.schema\.json$/, '');
  const schemaPath = path.join(schemaDir, schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  assert.equal(schema.$id, `usr/${schemaFile}`, `schema $id must match canonical path for ${schemaFile}`);
  assert.equal(Array.isArray(schema.allOf), true, `${schemaFile} must compose from allOf`);
  assert.equal(schema.allOf.some((entry) => entry && entry.$ref === './evidence-envelope.schema.json'), true, `${schemaFile} must reference evidence-envelope via allOf`);

  assert.equal(schema.type, 'object', `${schemaFile} must declare top-level object type`);
  assert.equal(schema.unevaluatedProperties, false, `${schemaFile} must reject unknown top-level keys via unevaluatedProperties=false`);

  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const field of ['artifactId', 'summary', 'rows']) {
    assert.equal(required.has(field), true, `${schemaFile} missing required field: ${field}`);
  }

  assert.equal(schema?.properties?.artifactId?.const, artifactId, `${schemaFile} artifactId const must match file-derived artifact ID`);
  assert.equal(schema?.properties?.summary?.type, 'object', `${schemaFile} summary must be an object`);
  assert.equal(schema?.properties?.rows?.type, 'array', `${schemaFile} rows must be an array`);
}

console.log('usr doc schema contract validation checks passed');
