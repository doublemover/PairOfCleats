#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const matrixPath = path.join(repoRoot, 'lang', 'matrix', 'usr-backcompat-matrix.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const rows = Array.isArray(matrix.rows) ? matrix.rows : [];

assert.equal(rows.length >= 12, true, 'backcompat matrix must include at least BC-001 through BC-012 scenario rows');

const requiredIds = new Set(Array.from({ length: 12 }, (_, idx) => `BC-${String(idx + 1).padStart(3, '0')}`));
const seenIds = new Set();
for (const row of rows) {
  assert.equal(seenIds.has(row.id), false, `duplicate backcompat row id: ${row.id}`);
  seenIds.add(row.id);

  assert.equal(/^BC-\d{3}$/.test(row.id), true, `invalid backcompat row id format: ${row.id}`);
  assert.equal(/^usr-\d+\.\d+\.\d+$/.test(row.producerVersion), true, `invalid producerVersion format for ${row.id}`);

  const readerVersions = Array.isArray(row.readerVersions) ? row.readerVersions : [];
  assert.equal(readerVersions.length > 0, true, `readerVersions must be non-empty: ${row.id}`);
  for (const version of readerVersions) {
    assert.equal(/^usr-\d+\.\d+\.\d+$/.test(version), true, `invalid readerVersion format for ${row.id}: ${version}`);
  }

  assert.equal(['strict', 'non-strict'].includes(row.readerMode), true, `invalid readerMode for ${row.id}`);
  assert.equal(['accept', 'reject', 'accept-with-adapter'].includes(row.expectedOutcome), true, `invalid expectedOutcome for ${row.id}`);

  const diagnostics = Array.isArray(row.requiredDiagnostics) ? row.requiredDiagnostics : [];
  if (row.expectedOutcome === 'accept-with-adapter') {
    assert.equal(row.readerMode, 'non-strict', `accept-with-adapter rows must be non-strict: ${row.id}`);
    assert.equal(row.blocking, false, `accept-with-adapter rows must be non-blocking: ${row.id}`);
    assert.equal(diagnostics.includes('USR-W-BACKCOMPAT-ADAPTER'), true, `accept-with-adapter rows must include adapter diagnostic: ${row.id}`);
  }

  if (row.expectedOutcome === 'reject') {
    assert.equal(row.blocking, true, `reject rows must be blocking: ${row.id}`);
    assert.equal(diagnostics.length > 0, true, `reject rows must include required diagnostics: ${row.id}`);
  }
}

for (const id of requiredIds) {
  assert.equal(seenIds.has(id), true, `required backcompat row missing: ${id}`);
}

const strictRows = rows.filter((row) => row.readerMode === 'strict');
const nonStrictRows = rows.filter((row) => row.readerMode === 'non-strict');
assert.equal(strictRows.length > 0, true, 'backcompat matrix must include strict rows');
assert.equal(nonStrictRows.length > 0, true, 'backcompat matrix must include non-strict rows');

const pairwiseExpandedRows = rows.filter((row) => Array.isArray(row.readerVersions) && row.readerVersions.length > 1);
assert.equal(pairwiseExpandedRows.length > 0, true, 'backcompat matrix must include at least one pairwise-expanded readerVersions row');

console.log('backcompat matrix validation checks passed');
