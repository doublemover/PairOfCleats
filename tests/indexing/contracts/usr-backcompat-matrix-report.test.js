#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrBackcompatMatrixReport,
  validateUsrBackcompatMatrixCoverage
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const backcompatMatrixPayload = readMatrix('usr-backcompat-matrix.json');

const valid = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload,
  strictEnum: true
});
assert.equal(valid.ok, true, 'expected canonical backcompat matrix fixture to validate');
assert.equal(valid.errors.length, 0);

const validReport = buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload,
  strictEnum: true
});
assert.equal(validReport.payload.artifactId, 'usr-backcompat-matrix-results');
assert.equal(validReport.payload.status, 'pass');
assert.equal(validReport.payload.summary.errorCount, 0);

const adapterRow = structuredClone(
  backcompatMatrixPayload.rows.find((row) => row.expectedOutcome === 'accept-with-adapter') || backcompatMatrixPayload.rows[0]
);
adapterRow.id = 'BC-001';
adapterRow.blocking = true;
adapterRow.requiredDiagnostics = [];
const invalidPayload = {
  ...backcompatMatrixPayload,
  rows: [adapterRow]
};

const invalid = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: invalidPayload,
  strictEnum: true
});

assert.equal(invalid.ok, false, 'expected reduced invalid matrix payload to fail');
assert(
  invalid.errors.some((message) => message.includes('accept-with-adapter rows must be non-blocking')),
  'expected accept-with-adapter blocking validation error'
);
assert(
  invalid.errors.some((message) => message.includes('missing required backcompat scenario row')),
  'expected required BC id coverage error'
);
assert(
  invalid.errors.some((message) => message.includes('pairwise-expanded readerVersions row')),
  'expected pairwise-expanded coverage error'
);

console.log('usr backcompat matrix report test passed');
