#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const hoverBarrelPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types.js');
const hoverIndexPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'index.js');
const cachePath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'cache.js');
const concurrencyPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'concurrency.js');
const mergePath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'merge.js');
const metricsPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'metrics.js');
const stagesPath = path.join(root, 'src', 'integrations', 'tooling', 'providers', 'lsp', 'hover-types', 'stages.js');

for (const target of [
  hoverBarrelPath,
  hoverIndexPath,
  cachePath,
  concurrencyPath,
  mergePath,
  metricsPath,
  stagesPath
]) {
  assert.equal(fs.existsSync(target), true, `missing expected hover runtime modularization file: ${target}`);
}

const hoverBarrelSource = fs.readFileSync(hoverBarrelPath, 'utf8');
const hoverIndexSource = fs.readFileSync(hoverIndexPath, 'utf8');

assert.equal(
  hoverBarrelSource.includes("./hover-types/index.js"),
  true,
  'expected hover-types barrel to re-export the modularized runtime entrypoint'
);

for (const marker of [
  "./cache.js",
  "./concurrency.js",
  "./merge.js",
  "./metrics.js",
  "./stages.js",
  'loadLspRequestCache,',
  'createRequestBudgetController(',
  'createHoverFileStats(',
  'resolveRecordCandidate({',
  'handleStageRequestError({'
]) {
  assert.equal(
    hoverIndexSource.includes(marker),
    true,
    `expected hover runtime to delegate via ${marker}`
  );
}

for (const legacyInlineMarker of [
  'export const loadLspRequestCache = async',
  'export const clampIntRange = (value, fallback',
  'export const summarizeHoverMetrics = ({ hoverMetrics',
  'const buildSourceSignatureCandidate = (text, virtualRange) => {',
  'const handleStageRequestError = ({',
  'const resolveRecordCandidate = async (record, recordIndex) => {'
]) {
  assert.equal(
    hoverIndexSource.includes(legacyInlineMarker),
    false,
    `expected hover runtime to stop inlining ${legacyInlineMarker}`
  );
}

console.log('hover-types runtime modularization test passed');
