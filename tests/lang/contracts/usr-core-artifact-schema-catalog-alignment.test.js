#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USR_MATRIX_SCHEMA_DEFS } from '../../../src/contracts/schemas/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const catalogPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-artifact-schema-catalog.md');
const catalogText = fs.readFileSync(catalogPath, 'utf8');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseDocMandatoryKeys = (registryFileName) => {
  const escapedFileName = escapeRegex(registryFileName);
  const pattern = `\\|\\s*\`${escapedFileName}\`\\s*\\|\\s*([^\\n]+?)\\|`;
  const rowRegex = new RegExp(pattern);
  const match = catalogText.match(rowRegex);
  assert.notEqual(match, null, `catalog mandatory-key row missing: ${registryFileName}`);
  return [...match[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
};

const getSchemaRequiredKeys = (registryId) => {
  const schema = USR_MATRIX_SCHEMA_DEFS[registryId];
  assert.notEqual(schema, undefined, `schema registry not found: ${registryId}`);
  const required = schema?.properties?.rows?.items?.required;
  assert.equal(Array.isArray(required), true, `schema required-key array missing for registry: ${registryId}`);
  return [...required];
};

const assertSameKeySet = (label, expected, actual) => {
  const left = [...expected].sort();
  const right = [...actual].sort();
  assert.deepEqual(left, right, `${label} key mismatch\nexpected=${JSON.stringify(left)}\nactual=${JSON.stringify(right)}`);
};

const registryPairs = [
  ['usr-language-profiles', 'usr-language-profiles.json'],
  ['usr-framework-profiles', 'usr-framework-profiles.json'],
  ['usr-capability-matrix', 'usr-capability-matrix.json'],
  ['usr-backcompat-matrix', 'usr-backcompat-matrix.json']
];

for (const [registryId, registryFileName] of registryPairs) {
  const docKeys = parseDocMandatoryKeys(registryFileName);
  const schemaKeys = getSchemaRequiredKeys(registryId);
  assertSameKeySet(`${registryFileName} mandatory keys`, schemaKeys, docKeys);
}

console.log('usr core artifact schema catalog alignment checks passed');
