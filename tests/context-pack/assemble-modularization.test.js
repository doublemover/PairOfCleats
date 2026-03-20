#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assemblePath = path.join(root, 'src', 'context-pack', 'assemble.js');
const assembleDir = path.join(root, 'src', 'context-pack', 'assemble');
const seedPath = path.join(root, 'src', 'context-pack', 'seed-resolution.js');
const riskPath = path.join(root, 'src', 'context-pack', 'risk-ranking.js');
const excerptPath = path.join(root, 'src', 'context-pack', 'excerpt-cache.js');

for (const target of [
  assemblePath,
  assembleDir,
  seedPath,
  riskPath,
  excerptPath,
  path.join(assembleDir, 'index.js'),
  path.join(assembleDir, 'risk-load.js'),
  path.join(assembleDir, 'guidance.js'),
  path.join(assembleDir, 'call-sites.js'),
  path.join(assembleDir, 'budgets.js'),
  path.join(assembleDir, 'risk-slice.js'),
  path.join(assembleDir, 'finalize.js')
]) {
  assert.equal(fs.existsSync(target), true, `missing expected context-pack modularization file: ${target}`);
}

const source = fs.readFileSync(assemblePath, 'utf8');
const riskSliceSource = fs.readFileSync(path.join(assembleDir, 'risk-slice.js'), 'utf8');
const finalizeSource = fs.readFileSync(path.join(assembleDir, 'finalize.js'), 'utf8');

for (const marker of [
  "export * from './assemble/index.js';"
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected context-pack assembly to delegate via ${marker}`
  );
}

for (const marker of [
  "from './guidance.js'",
  "from './budgets.js'",
  "from './call-sites.js'",
  "from './risk-load.js'"
]) {
  assert.equal(
    riskSliceSource.includes(marker),
    true,
    `expected risk slice module to delegate via ${marker}`
  );
}

for (const marker of [
  "from './risk-slice.js'",
  "from '../seed-resolution.js'",
  "from '../excerpt-cache.js'"
]) {
  assert.equal(
    finalizeSource.includes(marker),
    true,
    `expected finalize module to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const buildRiskGuidance = ({',
  'const buildRiskSlice = ({',
  'export const assembleCompositeContextPack = ({',
  'export const assembleCompositeContextPackStreaming = async ({'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected context-pack assembly to stop inlining ${legacyInlineMarker}`
  );
}

console.log('context pack assembly modularization test passed');
