#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonPath = path.join(root, 'src', 'shared', 'artifact-io', 'json.js');
const fallbackPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'fallback.js');
const readPlanPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'read-plan.js');

for (const target of [jsonPath, fallbackPath, readPlanPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected artifact-io modularization file: ${target}`);
}

const source = fs.readFileSync(jsonPath, 'utf8');

for (const marker of [
  "./json/fallback.js",
  "./json/read-plan.js",
  'canUseFallbackAfterPrimaryError(',
  'resolveJsonlReadPlan(',
  'resolveOptionalZstd('
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected shared artifact-io json module to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolveOptionalZstd = () => {',
  'const resolveJsonlReadPlan = (byteSize) => {',
  'const canUseFallbackAfterPrimaryError = (primaryErr, recoveryFallback) => ('
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected shared artifact-io json module to stop inlining ${legacyInlineMarker}`
  );
}

console.log('artifact-io json modularization test passed');
