#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'release-check-schema');
const reportPath = path.join(outDir, 'release_check_report.json');
const manifestPath = path.join(outDir, 'release-manifest.json');

await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const run = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'release', 'check.js'),
    '--dry-run',
    '--report',
    reportPath,
    '--manifest',
    manifestPath
  ],
  {
    cwd: root,
    encoding: 'utf8'
  }
);

if (run.status !== 0) {
  console.error('report-schema test failed: release-check returned non-zero');
  process.exit(run.status ?? 1);
}

const report = JSON.parse(await fsPromises.readFile(reportPath, 'utf8'));
const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));

if (report.schemaVersion !== 1 || manifest.schemaVersion !== 1) {
  console.error('report-schema test failed: schemaVersion mismatch');
  process.exit(1);
}

if (!ISO_RE.test(report.generatedAt) || !ISO_RE.test(report.startedAt) || !ISO_RE.test(report.finishedAt)) {
  console.error('report-schema test failed: non-ISO report timestamps');
  process.exit(1);
}

if (!Array.isArray(report.checks) || report.checks.length === 0) {
  console.error('report-schema test failed: checks missing');
  process.exit(1);
}

for (const check of report.checks) {
  if (!check.id || !check.phase || !check.label) {
    console.error('report-schema test failed: required check fields missing');
    process.exit(1);
  }
  if (!ISO_RE.test(check.startedAt) || !ISO_RE.test(check.finishedAt)) {
    console.error(`report-schema test failed: non-ISO step timestamps for ${check.id}`);
    process.exit(1);
  }
}

if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
  console.error('report-schema test failed: manifest artifacts missing');
  process.exit(1);
}

const reportRel = path.relative(root, reportPath).replace(/\\/g, '/');
const reportArtifact = manifest.artifacts.find((entry) => entry.path === reportRel);
if (!reportArtifact || reportArtifact.exists !== true || !Number.isFinite(reportArtifact.sizeBytes) || !reportArtifact.sha256) {
  console.error('report-schema test failed: report artifact metadata missing or invalid');
  process.exit(1);
}

console.log('release-check report schema test passed');
