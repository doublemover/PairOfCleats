#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonPath = path.join(root, 'src', 'shared', 'artifact-io', 'json.js');
const fallbackPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'fallback.js');
const readPlanPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'read-plan.js');
const readJsonPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'read-json.js');
const readJsonlStreamPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'read-jsonl-stream.js');
const readJsonlArrayPath = path.join(root, 'src', 'shared', 'artifact-io', 'json', 'read-jsonl-array.js');

for (const target of [
  jsonPath,
  fallbackPath,
  readPlanPath,
  readJsonPath,
  readJsonlStreamPath,
  readJsonlArrayPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected artifact-io modularization file: ${target}`);
}

const source = fs.readFileSync(jsonPath, 'utf8');

for (const marker of [
  "./json/read-json.js",
  "./json/read-jsonl-stream.js",
  "./json/read-jsonl-array.js",
  'export { readJsonFile }',
  'export {',
  'readJsonLinesIterator'
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected shared artifact-io json module to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'export const readJsonFile = (',
  'export const readJsonLinesEach = async (',
  'export const readJsonLinesIterator = function (',
  'export const readJsonLinesArray = async (',
  'export const readJsonLinesArraySync = ('
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected shared artifact-io json module to stop inlining ${legacyInlineMarker}`
  );
}

console.log('artifact-io json modularization test passed');
