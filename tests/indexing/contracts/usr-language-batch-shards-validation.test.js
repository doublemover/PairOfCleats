#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsrLanguageBatchShards } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const batchShardsPayload = readMatrix('usr-language-batch-shards.json');
const languageProfilesPayload = readMatrix('usr-language-profiles.json');

const valid = validateUsrLanguageBatchShards({
  batchShardsPayload,
  languageProfilesPayload
});
assert.equal(valid.ok, true, 'expected canonical language batch shards matrix to validate');
assert.equal(valid.errors.length, 0);

const invalidPayload = structuredClone(batchShardsPayload);
const targetRow = invalidPayload.rows.find((row) => row.id === 'B1') || invalidPayload.rows[0];
assert.ok(targetRow, 'expected at least one batch shard row');
targetRow.dependsOn = [];
targetRow.languageIds = [...(targetRow.languageIds || [])].reverse();

const invalid = validateUsrLanguageBatchShards({
  batchShardsPayload: invalidPayload,
  languageProfilesPayload
});
assert.equal(invalid.ok, false, 'expected invalid shard dependencies/sort order to fail');
assert(
  invalid.errors.some((message) => message.includes('dependsOn must match canonical dependency set')),
  'expected dependency-set validation error'
);
assert(
  invalid.errors.some((message) => message.includes('languageIds must be sorted ascending for deterministic manifests')),
  'expected sorted languageIds validation error'
);

console.log('usr language batch shards validation test passed');
