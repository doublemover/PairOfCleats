#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const artifactsWritePath = path.join(root, 'src', 'index', 'build', 'artifacts-write.js');
const runtimeHelpersPath = path.join(root, 'src', 'index', 'build', 'artifacts', 'write-runtime-helpers.js');

for (const target of [artifactsWritePath, runtimeHelpersPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected artifact write helper module: ${target}`);
}

const source = fs.readFileSync(artifactsWritePath, 'utf8');

for (const marker of [
  "./artifacts/write-runtime-helpers.js",
  'buildBoilerplateCatalog(',
  'readStableIndexStateHash(',
  'writeBinaryArtifactAtomically('
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected artifacts-write module to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const readStableIndexStateHash = async (',
  'const buildBoilerplateCatalog = (',
  'const writeBinaryArtifactAtomically = async ('
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected artifacts-write module to stop inlining ${legacyInlineMarker}`
  );
}

console.log('artifact write runtime helper extraction test passed');
