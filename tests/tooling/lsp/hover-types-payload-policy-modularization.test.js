#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const hoverTypesPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types.js');
const hoverTypesIndexPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'index.js');
const payloadPolicyPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'payload-policy.js');

for (const target of [hoverTypesPath, hoverTypesIndexPath, payloadPolicyPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected hover payload-policy file: ${target}`);
}

const hoverBarrelSource = fs.readFileSync(hoverTypesPath, 'utf8');
const hoverIndexSource = fs.readFileSync(hoverTypesIndexPath, 'utf8');

assert.equal(
  hoverBarrelSource.includes("./hover-types/index.js"),
  true,
  'expected hover-types barrel to re-export the modularized index surface'
);

for (const marker of [
  "./payload-policy.js",
  'buildFallbackReasonCodes,',
  'buildLspProvenanceEntry,',
  'buildLspSymbolRef,',
  'createEmptyHoverMetricsResult,',
  'scoreLspConfidence,'
]) {
  assert.equal(
    hoverIndexSource.includes(marker),
    true,
    `expected hover-types to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'const scoreLspConfidence = ({',
  'const buildLspSymbolRef = ({',
  'const buildLspProvenanceEntry = ({',
  'export const createEmptyHoverMetricsResult = () => ({',
  'const buildFallbackReasonCodes = ({'
]) {
  assert.equal(
    hoverIndexSource.includes(legacyInlineMarker),
    false,
    `expected hover-types to stop inlining ${legacyInlineMarker}`
  );
}

console.log('hover-types payload-policy modularization test passed');
