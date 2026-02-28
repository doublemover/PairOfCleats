#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-stage-pipeline');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'go'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'MODULE.bazel'), 'module(name = "demo")\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'go', 'extensions.bzl'), 'def go_deps():\n  pass\n', 'utf8');

const entries = [
  { abs: path.join(tempRoot, 'MODULE.bazel'), rel: 'MODULE.bazel' },
  { abs: path.join(tempRoot, 'go', 'extensions.bzl'), rel: 'go/extensions.bzl' }
];
const importsByFile = {
  'MODULE.bazel': ['//go:extensions.bzl', '//go:missing_extension.bzl']
};
const fileRelations = new Map([
  ['MODULE.bazel', { imports: importsByFile['MODULE.bazel'].slice() }]
]);

const resolution = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations,
  enableGraph: true
});

const stages = resolution?.stats?.resolverPipelineStages || {};
assert.equal((stages.normalize?.attempts || 0) >= 2, true, 'expected normalize stage attempts');
assert.equal((stages.language_resolver?.attempts || 0) >= 2, true, 'expected language_resolver stage attempts');
assert.equal((stages.build_system_resolver?.attempts || 0) >= 1, true, 'expected build_system_resolver stage attempts');
assert.equal((stages.classify?.attempts || 0) >= 1, true, 'expected classify stage attempts');
assert.equal((stages.filesystem_probe?.attempts || 0) >= 1, true, 'expected filesystem_probe stage attempts');
assert.equal(Number.isFinite(Number(stages.classify?.elapsedMs)), true, 'expected classify stage elapsedMs');
assert.equal(Number.isFinite(Number(stages.classify?.budgetExhausted)), true, 'expected classify stage budgetExhausted counter');
assert.equal(Number.isFinite(Number(stages.classify?.degraded)), true, 'expected classify stage degraded counter');

const warnings = Array.isArray(resolution?.unresolvedSamples) ? resolution.unresolvedSamples : [];
assert.equal(warnings.length, 1);
assert.equal(warnings[0].reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(warnings[0].resolverStage, 'language_resolver');
assert.equal((stages.language_resolver?.degraded || 0) >= 1, true, 'expected unresolved resolver gap to increment degraded stage counter');

const graphStageStats = resolution?.graph?.stats?.resolverPipelineStages || {};
assert.deepEqual(
  graphStageStats,
  stages,
  'expected graph and top-level stage pipeline stats to match'
);

console.log('import resolution stage pipeline tests passed');
