#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUsrReportIds, USR_REQUIRED_AUDIT_REPORT_IDS } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const catalogPath = path.join(repoRoot, 'docs', 'specs', 'usr-core-artifact-schema-catalog.md');
const catalogText = fs.readFileSync(catalogPath, 'utf8');

const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

const section = extractSection(
  catalogText,
  '## Blocking evidence artifact schema coverage',
  '## Drift prevention'
);

const rows = [...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*$/gm)]
  .map((match) => ({
    artifactId: match[1].trim(),
    schemaPath: match[2].trim(),
    coverageClass: match[3].trim()
  }));

assert.equal(rows.length > 0, true, 'blocking evidence schema coverage table must include rows');

const reportIds = new Set(listUsrReportIds());
const seenArtifactIds = new Set();

for (const row of rows) {
  assert.equal(seenArtifactIds.has(row.artifactId), false, `duplicate blocking evidence artifact row: ${row.artifactId}`);
  seenArtifactIds.add(row.artifactId);

  assert.equal(reportIds.has(row.artifactId), true, `blocking evidence artifact must have registered report schema validator: ${row.artifactId}`);

  const expectedSuffix = `docs/schemas/usr/${row.artifactId}.schema.json`;
  assert.equal(row.schemaPath, expectedSuffix, `blocking evidence schema path must match canonical artifact schema file naming: ${row.artifactId}`);

  const fullSchemaPath = path.join(repoRoot, row.schemaPath.replace(/\//g, path.sep));
  assert.equal(fs.existsSync(fullSchemaPath), true, `blocking evidence schema file missing: ${row.schemaPath}`);
  assert.equal(row.coverageClass.length > 0, true, `coverage class must be non-empty: ${row.artifactId}`);
}

for (const requiredArtifactId of USR_REQUIRED_AUDIT_REPORT_IDS) {
  assert.equal(seenArtifactIds.has(requiredArtifactId), true, `required audit artifact missing from blocking evidence schema table: ${requiredArtifactId}`);
}

console.log('usr blocking evidence schema catalog validation checks passed');
