#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const manifestPath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'minimum-slice', 'typescript-vue', 'usr-minimum-slice-manifest.json');
const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const qualityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-quality-gates.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const qualityGates = JSON.parse(fs.readFileSync(qualityGatesPath, 'utf8'));

assert.equal(manifest.sliceId, 'minimum-slice-typescript-vue', 'unexpected minimum-slice manifest id');

for (const entrypoint of manifest.entrypoints || []) {
  const entrypointPath = path.join(path.dirname(manifestPath), entrypoint.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(entrypointPath), true, `minimum-slice entrypoint missing: ${entrypoint}`);
}

const governanceFixtureIds = new Set((fixtureGovernance.rows || []).map((row) => row.fixtureId));
for (const fixtureId of manifest.fixtureIds || []) {
  assert.equal(governanceFixtureIds.has(fixtureId), true, `minimum-slice fixture is missing from governance matrix: ${fixtureId}`);
}

const minimumSliceGate = (qualityGates.rows || []).find((row) => row.id === 'qg-min-slice-typescript-vue');
assert.equal(Boolean(minimumSliceGate), true, 'minimum-slice quality gate row is missing');
assert.equal(minimumSliceGate.blocking, true, 'minimum-slice quality gate must be blocking');
assert.equal(minimumSliceGate.fixtureSetId, manifest.sliceId, 'minimum-slice quality gate must target manifest slice id');

const runId = 'run-usr-minimum-slice-typescript-vue-001';
const lane = 'lang-smoke';
for (const reportFileName of manifest.requiredReports || []) {
  const artifactId = reportFileName.replace(/\.json$/, '');
  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId,
    generatedAt: '2026-02-12T03:00:00Z',
    producerId: 'usr-minimum-slice-harness',
    runId,
    lane,
    buildId: null,
    status: 'pass',
    scope: {
      scopeType: 'framework',
      scopeId: 'vue'
    },
    summary: {
      sliceId: manifest.sliceId,
      fixtureCount: (manifest.fixtureIds || []).length,
      entrypointCount: (manifest.entrypoints || []).length
    },
    rows: [
      {
        sliceId: manifest.sliceId,
        reportArtifactId: artifactId,
        status: 'pass'
      }
    ]
  };

  const result = validateUsrReport(artifactId, payload);
  assert.equal(result.ok, true, `${artifactId} must validate: ${result.errors.join('; ')}`);
}

console.log('usr minimum-slice harness checks passed');
