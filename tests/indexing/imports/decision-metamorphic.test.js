#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyUnresolvedImportSample } from '../../../src/index/build/imports.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const windowsVariant = classifyUnresolvedImportSample({
  importer: 'src\\main.js',
  specifier: '.\\foo\\bar.js',
  reason: 'missing'
});
const redundantSegmentVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/./bar.js',
  reason: 'missing'
});
const normalizedVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reason: 'missing'
});

assert.equal(windowsVariant.reasonCode, 'IMP_U_UNKNOWN');
assert.equal(redundantSegmentVariant.reasonCode, 'IMP_U_UNKNOWN');
assert.equal(normalizedVariant.failureCause, 'unknown');

const explicitReasonCodeA = classifyUnresolvedImportSample({
  importer: 'src\\main.js',
  specifier: '.\\foo\\bar.js',
  reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
  failureCause: 'missing_file',
  disposition: 'actionable',
  resolverStage: 'filesystem_probe'
});
const explicitReasonCodeB = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
  failureCause: 'missing_file',
  disposition: 'actionable',
  resolverStage: 'filesystem_probe'
});

assert.equal(explicitReasonCodeA.reasonCode, explicitReasonCodeB.reasonCode);
assert.equal(explicitReasonCodeA.failureCause, explicitReasonCodeB.failureCause);
assert.equal(explicitReasonCodeA.disposition, explicitReasonCodeB.disposition);
assert.equal(explicitReasonCodeA.resolverStage, explicitReasonCodeB.resolverStage);

const parseReasonVariant = classifyUnresolvedImportSample({
  importer: 'src/main.js',
  specifier: './foo/bar.js',
  reason: 'parse_error'
});
assert.equal(parseReasonVariant.reasonCode, 'IMP_U_PARSE_ERROR');
assert.equal(parseReasonVariant.failureCause, 'parse_error');

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-decision-metamorphic');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src', 'foo'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'src', 'main.js'), 'export const entry = true;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'foo', 'bar.js'), 'export const ok = true;\n', 'utf8');

const entries = [
  { abs: path.join(tempRoot, 'src', 'main.js'), rel: 'src/main.js' },
  { abs: path.join(tempRoot, 'src', 'foo', 'bar.js'), rel: 'src/foo/bar.js' }
];
const createFileRelations = (importerKey, specifier) => new Map([
  [importerKey, { imports: [specifier] }]
]);

const resolvedWindows = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile: { 'src\\main.js': ['.\\foo\\bar.js'] },
  fileRelations: createFileRelations('src\\main.js', '.\\foo\\bar.js'),
  enableGraph: true
});
const resolvedPosix = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile: { 'src/main.js': ['./foo/./bar.js'] },
  fileRelations: createFileRelations('src/main.js', './foo/./bar.js'),
  enableGraph: true
});
assert.equal(resolvedWindows.stats?.resolved, 1);
assert.equal(resolvedPosix.stats?.resolved, 1);
assert.deepEqual(
  resolvedWindows.graph?.edges?.map((edge) => edge?.resolvedPath).filter(Boolean),
  ['src/foo/bar.js']
);
assert.deepEqual(
  resolvedPosix.graph?.edges?.map((edge) => edge?.resolvedPath).filter(Boolean),
  ['src/foo/bar.js']
);

const unresolvedWindows = resolveImportLinks({
  root: tempRoot,
  entries: [{ abs: path.join(tempRoot, 'src', 'main.js'), rel: 'src/main.js' }],
  importsByFile: { 'src\\main.js': ['.\\foo\\missing.js'] },
  fileRelations: createFileRelations('src\\main.js', '.\\foo\\missing.js'),
  enableGraph: true
});
const unresolvedPosix = resolveImportLinks({
  root: tempRoot,
  entries: [{ abs: path.join(tempRoot, 'src', 'main.js'), rel: 'src/main.js' }],
  importsByFile: { 'src/main.js': ['./foo/./missing.js'] },
  fileRelations: createFileRelations('src/main.js', './foo/./missing.js'),
  enableGraph: true
});
const unresolvedWarningA = unresolvedWindows.unresolvedSamples?.[0] || null;
const unresolvedWarningB = unresolvedPosix.unresolvedSamples?.[0] || null;
assert.equal(Boolean(unresolvedWarningA), true);
assert.equal(Boolean(unresolvedWarningB), true);
assert.equal(unresolvedWarningA?.reasonCode, unresolvedWarningB?.reasonCode);
assert.equal(unresolvedWarningA?.failureCause, unresolvedWarningB?.failureCause);
assert.equal(unresolvedWarningA?.disposition, unresolvedWarningB?.disposition);
assert.equal(unresolvedWarningA?.resolverStage, unresolvedWarningB?.resolverStage);

console.log('import resolution decision metamorphic test passed');
