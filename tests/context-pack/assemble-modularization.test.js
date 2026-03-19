#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assemblePath = path.join(root, 'src', 'context-pack', 'assemble.js');
const seedPath = path.join(root, 'src', 'context-pack', 'seed-resolution.js');
const riskPath = path.join(root, 'src', 'context-pack', 'risk-ranking.js');
const excerptPath = path.join(root, 'src', 'context-pack', 'excerpt-cache.js');

for (const target of [assemblePath, seedPath, riskPath, excerptPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected context-pack modularization file: ${target}`);
}

const source = fs.readFileSync(assemblePath, 'utf8');

for (const marker of [
  "./seed-resolution.js",
  "./risk-ranking.js",
  "./excerpt-cache.js",
  'buildChunkIndex',
  'resolveChunkCandidatesBySeed(',
  'rankRiskFlows(',
  'buildPrimaryExcerpt(',
  'clearContextPackCaches'
]) {
  assert.equal(
    source.includes(marker),
    true,
    `expected context-pack assembly to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const resolveSeedRef = (seed) => {',
  'const rankRiskFlows = (flows, riskAnchor) => Array.from(',
  'export const clearContextPackCaches = () => {',
  'const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, indexSignature, warnings }) => {'
]) {
  assert.equal(
    source.includes(legacyInlineMarker),
    false,
    `expected context-pack assembly to stop inlining ${legacyInlineMarker}`
  );
}

console.log('context pack assembly modularization test passed');
