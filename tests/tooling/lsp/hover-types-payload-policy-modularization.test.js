#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const hoverTypesPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types.js');
const payloadPolicyPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'payload-policy.js');

for (const target of [hoverTypesPath, payloadPolicyPath]) {
  assert.equal(fs.existsSync(target), true, `missing expected hover payload-policy file: ${target}`);
}

const hoverSource = fs.readFileSync(hoverTypesPath, 'utf8');

for (const marker of [
  "./hover-types/payload-policy.js",
  'buildFallbackReasonCodes(',
  'buildLspProvenanceEntry(',
  'buildLspSymbolRef(',
  'createEmptyHoverMetricsResult,',
  'scoreLspConfidence('
]) {
  assert.equal(
    hoverSource.includes(marker),
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
    hoverSource.includes(legacyInlineMarker),
    false,
    `expected hover-types to stop inlining ${legacyInlineMarker}`
  );
}

console.log('hover-types payload-policy modularization test passed');
