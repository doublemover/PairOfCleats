#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUsrLanguageBatchShards } from '../../../src/contracts/validators/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const languageProfilesPath = path.join(matrixDir, 'usr-language-profiles.json');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const batchShardsPath = path.join(matrixDir, 'usr-language-batch-shards.json');
const batchShards = JSON.parse(fs.readFileSync(batchShardsPath, 'utf8'));

const validation = validateUsrLanguageBatchShards({
  batchShardsPayload: batchShards,
  languageProfilesPayload: languageProfiles
});
assert.equal(validation.ok, true, `language batch shards should validate: ${validation.errors.join('; ')}`);

const missingLanguage = validateUsrLanguageBatchShards({
  batchShardsPayload: {
    ...batchShards,
    rows: (batchShards.rows || []).map((row) => (
      row.id === 'B4'
        ? { ...row, languageIds: (row.languageIds || []).filter((languageId) => languageId !== 'python') }
        : row
    ))
  },
  languageProfilesPayload: languageProfiles
});
assert.equal(missingLanguage.ok, false, 'language batch shard validation should fail when a registry language is not assigned to a batch');

console.log('usr language batch shard validation checks passed');
