#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const artifactsWritePath = path.join(root, 'src', 'index', 'build', 'artifacts-write.js');
const artifactsWriteIndexPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'index.js');
const planningPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'planning.js');
const publicationPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'publication.js');
const telemetryPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'telemetry.js');
const runtimePath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'runtime.js');
const familyDispatchPath = path.join(root, 'src', 'index', 'build', 'artifacts-write', 'family-dispatch.js');
const runtimeHelpersPath = path.join(root, 'src', 'index', 'build', 'artifacts', 'write-runtime-helpers.js');

for (const target of [
  artifactsWritePath,
  artifactsWriteIndexPath,
  planningPath,
  publicationPath,
  telemetryPath,
  runtimePath,
  familyDispatchPath,
  runtimeHelpersPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected artifact write helper module: ${target}`);
}

const barrelSource = fs.readFileSync(artifactsWritePath, 'utf8');
const indexSource = fs.readFileSync(artifactsWriteIndexPath, 'utf8');

assert.equal(
  barrelSource.includes("./artifacts-write/index.js"),
  true,
  'expected top-level artifacts-write module to delegate to the modularized index'
);

for (const marker of [
  "../artifacts/write-runtime-helpers.js",
  "./planning.js",
  "./publication.js",
  "./telemetry.js",
  "./runtime.js",
  "./family-dispatch.js",
  'buildBoilerplateCatalog(',
  'readStableIndexStateHash(',
  'writeBinaryArtifactAtomically(',
  'normalizeArtifactWriteInput(',
  'resolveArtifactWriteRuntime(',
  'createArtifactWriteExecutionState(',
  'prepareArtifactCleanup('
]) {
  assert.equal(
    indexSource.includes(marker),
    true,
    `expected artifacts-write index to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const readStableIndexStateHash = async (',
  'const buildBoilerplateCatalog = (',
  'const writeBinaryArtifactAtomically = async ('
]) {
  assert.equal(
    indexSource.includes(legacyInlineMarker),
    false,
    `expected artifacts-write index to stop inlining ${legacyInlineMarker}`
  );
}

console.log('artifact write runtime helper extraction test passed');
