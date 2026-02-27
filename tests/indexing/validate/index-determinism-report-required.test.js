#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const determinismConfig = {
  ...defaultUserConfig,
  indexing: {
    ...(defaultUserConfig.indexing || {}),
    artifacts: {
      determinismReport: true
    }
  }
};

const makeDeterminismPayload = (mode = 'code') => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode,
  stableHashExclusions: ['generatedAt', 'updatedAt'],
  sourceReasons: [
    {
      path: 'generatedAt',
      category: 'time',
      reason: 'test',
      source: 'tests/indexing/validate/index-validate-determinism-report-required.test.js'
    }
  ],
  normalizedStateHash: 'abc123abc123abc123'
});

const missingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-validate-determinism-missing-'));
const missingIndex = await createBaseIndex({ rootDir: missingRoot });
const missingReport = await validateIndexArtifacts({
  root: missingIndex.repoRoot,
  indexRoot: missingIndex.indexRoot,
  userConfig: determinismConfig,
  modes: ['code'],
  strict: true,
  sqliteEnabled: false
});
assert.equal(missingReport.ok, false, 'strict validation should fail without determinism_report when enabled');
assert.ok(
  missingReport.issues.some((issue) => issue.includes('missing determinism_report')),
  'expected missing determinism_report issue'
);

const presentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-validate-determinism-present-'));
const presentPieces = [
  { type: 'chunks', name: 'chunk_meta', format: 'json', path: 'chunk_meta.json' },
  { type: 'chunks', name: 'file_meta', format: 'json', path: 'file_meta.json' },
  { type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' },
  { type: 'stats', name: 'index_state', format: 'json', path: 'index_state.json' },
  { type: 'stats', name: 'filelists', format: 'json', path: '.filelists.json' },
  { type: 'stats', name: 'determinism_report', format: 'json', path: 'determinism_report.json' }
];
const presentIndex = await createBaseIndex({
  rootDir: presentRoot,
  manifestPieces: presentPieces
});
await fs.writeFile(
  path.join(presentIndex.indexDir, 'determinism_report.json'),
  JSON.stringify(makeDeterminismPayload(), null, 2),
  'utf8'
);
const presentReport = await validateIndexArtifacts({
  root: presentIndex.repoRoot,
  indexRoot: presentIndex.indexRoot,
  userConfig: determinismConfig,
  modes: ['code'],
  strict: true,
  sqliteEnabled: false
});
assert.equal(presentReport.ok, true, `validation should pass with determinism_report: ${presentReport.issues.join('; ')}`);

console.log('index validate determinism_report required test passed');
