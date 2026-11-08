#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImportEntries } from '../../../src/index/language-registry.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { createImportResolutionTempRoot, createImportResolutionCacheStats } from '../../helpers/import-resolution-fixture.js';

const root = await createImportResolutionTempRoot('bazel-label-graph-replay');
const importer = 'app/rules.bzl';
const labels = ['//tools:defs.bzl', '//tools:missing.bzl', '//tools:../other.bzl',
  '//tools/pkg', '//tools/pkg:defs', '//tools/pkg:defs.bzl', '//tools:plain/defs.bzl',
  '//tools:pkg/defs.bzl', ':local.bzl', '@repo//tools:defs.bzl',
  '//tools:defs.bzl#fragment', '//tools:defs.bzl?query'];
const source = labels.map((label, n) => `load("${label}", "macro_${n}")`).join('\n');
const files = ['app/BUILD', importer, 'app/local.bzl', 'tools/BUILD', 'tools/defs.bzl',
  'tools/tools.bzl', 'tools/pkg.bzl', 'other.bzl', 'tools/pkg/BUILD', 'tools/pkg/pkg.bzl',
  'tools/pkg/defs.bzl', 'tools/plain/defs.bzl'];
try {
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), file === importer ? source : '# fixture\n');
  }
  const collected = collectLanguageImportEntries({ ext: '.bzl', relPath: importer, text: source, mode: 'code' });
  const specifiers = collected.map(entry => entry.specifier);
  assert.deepEqual([...specifiers].sort(), [...labels].sort(), 'preserve all original query spellings');
  const cache = {};
  const run = () => {
    const relations = new Map([[importer, { imports: [...specifiers] }]]);
    const cacheStats = createImportResolutionCacheStats();
    const result = resolveImportLinks({ root, entries: files.map(rel => ({ rel, abs: path.join(root, rel) })),
      importsByFile: { [importer]: specifiers }, fileRelations: relations, enableGraph: true,
      cache, cacheStats, fileHashes: new Map([[importer, 'unchanged-source']]), mode: 'code' });
    // Reproduce the persisted JSON boundary, including unresolved trace witnesses.
    return { graph: JSON.parse(JSON.stringify(result.graph)), relation: relations.get(importer), cacheStats };
  };
  const first = run();
  assert.deepEqual(first.relation.importLinks, ['app/local.bzl', 'tools/defs.bzl', 'tools/pkg/defs.bzl', 'tools/plain/defs.bzl']);
  const edges = new Map(first.graph.edges.map(edge => [edge.rawSpecifier, edge]));
  for (const label of labels.filter(value => !['//tools:defs.bzl', '//tools/pkg:defs.bzl', '//tools:plain/defs.bzl', ':local.bzl'].includes(value))) {
    assert.equal(edges.get(label)?.resolutionState, 'unresolved', label);
    assert.equal(edges.get(label)?.resolvedPath, null, label);
    assert.ok(edges.get(label)?.resolverTrace.some(stage => stage.adapter === 'bazel-label'), label);
  }
  const missing = edges.get('//tools:missing.bzl').resolverTrace.find(stage => stage.details?.labelState === 'target-missing');
  assert.deepEqual(missing.details.candidates, ['tools/missing.bzl']);
  assert.equal(missing.details.packageExists, true);
  assert.equal(missing.details.targetScope, 'admitted-file-inventory');
  assert.ok(missing.details.packageWitnesses.some(witness => witness.path === 'tools/BUILD' && witness.state === 'present'));
  const warm = run();
  assert.deepEqual(warm.relation.importLinks, first.relation.importLinks);
  assert.ok(warm.cacheStats.specsReused > 0, 'unchanged BUILD observations support warm reuse');
  await fs.writeFile(path.join(root, 'tools/plain/BUILD'), '# new subpackage\n');
  const newBoundary = run();
  assert.deepEqual(newBoundary.relation.importLinks, ['app/local.bzl', 'tools/defs.bzl', 'tools/pkg/defs.bzl']);
  assert.equal(newBoundary.graph.edges.find(edge => edge.rawSpecifier === '//tools:plain/defs.bzl')?.resolutionState, 'unresolved');
  await fs.rm(path.join(root, 'tools/BUILD'));
  const removedPackage = run();
  assert.ok(!removedPackage.relation.importLinks.includes('tools/defs.bzl'), 'stale file inventory cannot qualify removed BUILD');
  assert.ok(removedPackage.relation.importLinks.includes('tools/pkg/defs.bzl'), 'independent package remains resolved');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('bazel label graph replay test passed');
