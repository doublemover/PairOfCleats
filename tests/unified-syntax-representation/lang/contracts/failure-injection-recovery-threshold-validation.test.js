#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const matrixPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-failure-injection-matrix.json');
const evidenceGatesPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-evidence-gates-waivers.md');
const matrixPayload = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const evidenceGatesText = fs.readFileSync(evidenceGatesPath, 'utf8');

const rows = Array.isArray(matrixPayload.rows) ? matrixPayload.rows : [];
assert.equal(rows.length > 0, true, 'failure-injection matrix must contain rows');

let hasNonImmediateRollbackThreshold = false;

for (const row of rows) {
  assert.equal(Number.isInteger(row.rollbackTriggerConsecutiveFailures), true, `rollbackTriggerConsecutiveFailures must be integer: ${row.id}`);
  assert.equal(row.rollbackTriggerConsecutiveFailures >= 1, true, `rollbackTriggerConsecutiveFailures must be >= 1: ${row.id}`);
  assert.equal(row.rollbackTriggerConsecutiveFailures <= 10, true, `rollbackTriggerConsecutiveFailures must be <= 10: ${row.id}`);

  if (row.rollbackTriggerConsecutiveFailures > 1) {
    hasNonImmediateRollbackThreshold = true;
  }

  const recoveryArtifacts = Array.isArray(row.requiredRecoveryArtifacts) ? row.requiredRecoveryArtifacts : [];
  assert.equal(recoveryArtifacts.length > 0, true, `requiredRecoveryArtifacts must be non-empty: ${row.id}`);

  for (const artifactFileName of recoveryArtifacts) {
    assert.equal(typeof artifactFileName === 'string' && artifactFileName.endsWith('.json'), true, `requiredRecoveryArtifacts must contain .json artifact IDs: ${row.id}`);

    const artifactId = artifactFileName.replace(/\.json$/, '');
    const schemaPath = path.join(repoRoot, 'docs', 'schemas', 'usr', `${artifactId}.schema.json`);
    assert.equal(fs.existsSync(schemaPath), true, `required recovery artifact must have schema file: ${artifactFileName}`);
  }

  if (row.blocking === true) {
    assert.equal(recoveryArtifacts.includes('usr-failure-injection-report.json'), true, `blocking failure-injection rows must require usr-failure-injection-report.json: ${row.id}`);
    assert.equal(recoveryArtifacts.includes('usr-rollback-drill-report.json'), true, `blocking failure-injection rows must require usr-rollback-drill-report.json: ${row.id}`);
  }
}

assert.equal(hasNonImmediateRollbackThreshold, true, 'failure-injection policy must include at least one row with rollbackTriggerConsecutiveFailures > 1');
assert.equal(evidenceGatesText.includes('`usr-failure-injection-report.json`'), true, 'evidence-gates spec must include usr-failure-injection-report.json');
assert.equal(evidenceGatesText.includes('`usr-rollback-drill-report.json`'), true, 'evidence-gates spec must include usr-rollback-drill-report.json');

console.log('usr failure-injection recovery threshold validation checks passed');
