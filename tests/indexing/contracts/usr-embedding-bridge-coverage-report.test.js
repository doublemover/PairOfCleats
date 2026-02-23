#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrEmbeddingBridgeCoverageReport,
  validateUsrEmbeddingBridgeCoverage
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readJson = (...segments) => JSON.parse(
  fs.readFileSync(path.join(root, ...segments), 'utf8')
);

const bridgeCasesPayload = readJson('tests', 'lang', 'matrix', 'usr-embedding-bridge-cases.json');
const bridgeBundlePayload = readJson(
  'tests',
  'fixtures',
  'usr',
  'embedding-bridges',
  'usr-embedding-bridge-bundle.json'
);

const valid = validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload,
  bridgeBundlePayload
});
assert.equal(valid.ok, true, 'expected canonical embedding bridge fixtures to validate');
assert.equal(valid.errors.length, 0);

const invalidBundlePayload = structuredClone(bridgeBundlePayload);
const firstBridgeRow = invalidBundlePayload.rows.find((row) => row.bridgeCaseId === bridgeCasesPayload.rows[0].id);
assert.ok(firstBridgeRow, 'expected first bridge row in fixture bundle');
firstBridgeRow.edges = firstBridgeRow.edges.filter((edge) => edge.kind !== 'template_emits');

const invalid = validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload,
  bridgeBundlePayload: invalidBundlePayload
});
assert.equal(invalid.ok, false, 'expected missing required edge kind to fail validation');
assert(
  invalid.errors.some((message) => message.includes('missing required edge kind: template_emits')),
  'expected required edge kind failure'
);

const report = buildUsrEmbeddingBridgeCoverageReport({
  bridgeCasesPayload,
  bridgeBundlePayload: invalidBundlePayload,
  lane: 'nightly',
  scope: { scopeType: 'lane', scopeId: 'nightly' }
});
assert.equal(report.payload.artifactId, 'usr-validation-report');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.dashboard, 'embedding-bridge-coverage');
assert.equal(report.payload.summary.errorCount > 0, true);
assert.equal(report.payload.scope.scopeType, 'lane');
assert.equal(report.payload.scope.scopeId, 'nightly');

console.log('usr embedding bridge coverage report test passed');
