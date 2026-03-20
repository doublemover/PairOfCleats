#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const barrelPath = path.join(root, 'src', 'index', 'build', 'artifacts-write.js');
const indexPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'index.js');
const planningPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'planning.js');
const publicationPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'publication.js');
const telemetryPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'telemetry.js');
const runtimePath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'runtime.js');
const familyDispatchPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'family-dispatch.js');

for (const target of [barrelPath, indexPath, planningPath, publicationPath, telemetryPath, runtimePath, familyDispatchPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected artifacts-write modularization file: ${target}`);
}

const barrelSource = fs.readFileSync(barrelPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');

assert.equal(
  barrelSource.includes("./artifacts-write/index.js"),
  true,
  'expected artifacts-write top-level module to delegate to the modularized index'
);

for (const marker of [
  './planning.js',
  './publication.js',
  './telemetry.js',
  './runtime.js',
  './family-dispatch.js',
  'createArtifactOrderingRecorder(',
  'createArtifactWriteTelemetryContext(',
  'normalizeArtifactWriteInput(',
  'resolveArtifactWriteRuntime(',
  'createArtifactWriteExecutionState(',
  'prepareArtifactCleanup(',
  'resolveQueuedWriteLanes(',
  'dispatchPlannedArtifactWrites(',
  'runArtifactPublicationFinalizers('
]) {
  assert.equal(
    indexSource.includes(marker),
    true,
    `expected artifacts-write index to compose ${marker}`
  );
}

console.log('artifacts-write modularization test passed');
