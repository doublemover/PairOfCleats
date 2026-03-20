#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const barrelPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'extracted-prose.js');
const moduleDir = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'extracted-prose');

for (const target of [
  barrelPath,
  moduleDir,
  path.join(moduleDir, 'index.js'),
  path.join(moduleDir, 'cohorts.js'),
  path.join(moduleDir, 'fingerprint.js'),
  path.join(moduleDir, 'history.js'),
  path.join(moduleDir, 'sampling.js'),
  path.join(moduleDir, 'state.js')
]) {
  assert.equal(fs.existsSync(target), true, `missing expected extracted-prose modularization file: ${target}`);
}

const barrelSource = fs.readFileSync(barrelPath, 'utf8');
const stateSource = fs.readFileSync(path.join(moduleDir, 'state.js'), 'utf8');

assert.equal(
  barrelSource.includes("export * from './extracted-prose/index.js';"),
  true,
  'expected extracted-prose barrel to delegate to index.js'
);

for (const marker of [
  "from './cohorts.js'",
  "from './fingerprint.js'",
  "from './history.js'",
  "from './sampling.js'"
]) {
  assert.equal(
    stateSource.includes(marker),
    true,
    `expected extracted-prose state module to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const buildExtractedProseRepoFingerprint = (entries = []) => {',
  'const selectWarmupEntries = ({',
  'const normalizeLowYieldHistory = (value) => {',
  'export const buildExtractedProseLowYieldBailoutState = ({'
]) {
  assert.equal(
    barrelSource.includes(legacyInlineMarker),
    false,
    `expected extracted-prose barrel to stop inlining ${legacyInlineMarker}`
  );
}

console.log('extracted prose low-yield modularization test passed');
