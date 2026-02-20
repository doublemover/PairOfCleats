#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');
const languageProfilesPayload = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const expectedIds = new Set((languageProfilesPayload.rows || []).map((row) => row?.id).filter(Boolean));

const registryIds = LANGUAGE_REGISTRY.map((entry) => entry?.id).filter(Boolean);
const registryIdSet = new Set(registryIds);

assert.equal(registryIds.length, registryIdSet.size, 'language registry ids must be unique');
assert.equal(registryIdSet.size, expectedIds.size, 'registry language count must match usr-language-profiles');

for (const id of expectedIds) {
  assert.ok(registryIdSet.has(id), `missing language adapter for ${id}`);
}
for (const id of registryIdSet) {
  assert.ok(expectedIds.has(id), `unexpected language adapter ${id}`);
}

const importCollectorIds = [
  'cmake',
  'starlark',
  'nix',
  'dart',
  'scala',
  'groovy',
  'r',
  'julia',
  'handlebars',
  'mustache',
  'jinja',
  'razor',
  'proto',
  'makefile',
  'dockerfile',
  'graphql'
];

for (const id of importCollectorIds) {
  const lang = LANGUAGE_REGISTRY.find((entry) => entry.id === id);
  assert.ok(lang, `missing import-collector adapter: ${id}`);
  assert.equal(typeof lang.collectImports, 'function', `${id} adapter collectImports must be implemented`);
  assert.equal(typeof lang.prepare, 'function', `${id} adapter prepare must be implemented`);
  assert.equal(typeof lang.buildRelations, 'function', `${id} adapter buildRelations must be implemented`);
  assert.equal(typeof lang.extractDocMeta, 'function', `${id} adapter extractDocMeta must be implemented`);
  assert.equal(typeof lang.flow, 'function', `${id} adapter flow must be implemented`);
}

assert.equal(getLanguageForFile('', 'infra/Makefile')?.id, 'makefile');
assert.equal(getLanguageForFile('', 'infra/GNUmakefile')?.id, 'makefile');
assert.equal(getLanguageForFile('.tmp', 'docker/Dockerfile.dev')?.id, 'dockerfile');
assert.equal(getLanguageForFile('', 'proto/buf.yaml')?.id, 'proto');
assert.equal(getLanguageForFile('', 'proto/buf.gen.yaml')?.id, 'proto');
assert.equal(getLanguageForFile('.proto', 'proto/schema/service.proto')?.id, 'proto');
assert.equal(getLanguageForFile('.graphql', 'schema/api.graphql')?.id, 'graphql');

console.log('language registry wiring test passed');
