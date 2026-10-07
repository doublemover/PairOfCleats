#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const analysisBarrelPath = path.join(root, 'src', 'contracts', 'schemas', 'analysis.js');
const analysisIndexPath = path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'index.js');
const modulePaths = [
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'primitives.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'metadata.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'policy.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'graph.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'risk.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'context-pack.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'api.js'),
  path.join(root, 'src', 'contracts', 'schemas', 'analysis', 'architecture.js')
];

for (const target of [analysisBarrelPath, analysisIndexPath, ...modulePaths]) {
  assert.equal(fs.existsSync(target), true, `missing expected analysis schema module: ${target}`);
}

const analysisBarrelSource = fs.readFileSync(analysisBarrelPath, 'utf8');
const analysisIndexSource = fs.readFileSync(analysisIndexPath, 'utf8');

assert.equal(
  analysisBarrelSource.includes("./analysis/index.js"),
  true,
  'expected top-level analysis schema file to re-export the modularized index'
);

for (const marker of [
  "./metadata.js",
  "./policy.js",
  "./graph.js",
  "./risk.js",
  "./context-pack.js",
  "./api.js",
  "./architecture.js",
  'METADATA_V2_SCHEMA',
  'RISK_RULES_BUNDLE_SCHEMA',
  'ANALYSIS_POLICY_SCHEMA',
  'GRAPH_CONTEXT_PACK_SCHEMA',
  'GRAPH_IMPACT_SCHEMA',
  'RISK_DELTA_SCHEMA',
  'COMPOSITE_CONTEXT_PACK_SCHEMA',
  'API_CONTRACTS_SCHEMA',
  'ARCHITECTURE_REPORT_SCHEMA',
  'SUGGEST_TESTS_SCHEMA'
]) {
  assert.equal(
    analysisIndexSource.includes(marker),
    true,
    `expected analysis schema index to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'export const METADATA_V2_SCHEMA = {',
  'export const RISK_RULES_BUNDLE_SCHEMA = {',
  'export const ANALYSIS_POLICY_SCHEMA = {',
  'export const GRAPH_CONTEXT_PACK_SCHEMA = {',
  'export const GRAPH_IMPACT_SCHEMA = {',
  'export const RISK_DELTA_SCHEMA = {',
  'export const COMPOSITE_CONTEXT_PACK_SCHEMA = {',
  'export const API_CONTRACTS_SCHEMA = {',
  'export const ARCHITECTURE_REPORT_SCHEMA = {',
  'export const SUGGEST_TESTS_SCHEMA = {'
]) {
  assert.equal(
    analysisBarrelSource.includes(legacyInlineMarker),
    false,
    `expected top-level analysis schema barrel to stop inlining ${legacyInlineMarker}`
  );
}

console.log('analysis schema modularization test passed');
