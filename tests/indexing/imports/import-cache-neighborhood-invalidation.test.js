#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { applyImportResolutionCacheFileSetDiffInvalidation } from '../../../src/index/build/import-resolution-cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-cache-neighborhood-invalidation');
const srcRoot = path.join(tempRoot, 'src');

const makeStats = () => ({
  files: 0,
  filesHashed: 0,
  filesReused: 0,
  filesInvalidated: 0,
  specs: 0,
  specsReused: 0,
  specsComputed: 0,
  packageInvalidated: false,
  fileSetInvalidated: false,
  lookupReused: false,
  lookupInvalidated: false,
  invalidationReasons: Object.create(null),
  fileSetDelta: { added: 0, removed: 0 },
  filesNeighborhoodInvalidated: 0,
  staleEdgeInvalidated: 0,
  staleEdgeChecks: 0,
  staleEdgeBudgetExhausted: false
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'a.js'), "import './shared.js';\n");
await fs.writeFile(path.join(srcRoot, 'b.js'), "import './shared.js';\n");
await fs.writeFile(path.join(srcRoot, 'c.js'), "import './other.js';\n");
await fs.writeFile(path.join(srcRoot, 'shared.js'), 'export const shared = true;\n');
await fs.writeFile(path.join(srcRoot, 'other.js'), 'export const other = true;\n');

const buildEntries = ({ includeShared = true, includeLater = false } = {}) => {
  const entries = [
    { abs: path.join(srcRoot, 'a.js'), rel: 'src/a.js' },
    { abs: path.join(srcRoot, 'b.js'), rel: 'src/b.js' },
    { abs: path.join(srcRoot, 'c.js'), rel: 'src/c.js' },
    { abs: path.join(srcRoot, 'other.js'), rel: 'src/other.js' }
  ];
  if (includeShared) {
    entries.push({ abs: path.join(srcRoot, 'shared.js'), rel: 'src/shared.js' });
  }
  if (includeLater) {
    entries.push({ abs: path.join(srcRoot, 'later.js'), rel: 'src/later.js' });
  }
  return entries;
};

const fileHashes = new Map([
  ['src/a.js', 'hash-a'],
  ['src/b.js', 'hash-b'],
  ['src/c.js', 'hash-c'],
  ['src/main.js', 'hash-main']
]);

const runResolution = ({
  cache,
  entries,
  importsByFile,
  fileRelations,
  maxStaleEdgeChecks = null
}) => {
  const cacheStats = makeStats();
  applyImportResolutionCacheFileSetDiffInvalidation({
    cache,
    entries,
    maxStaleEdgeChecks,
    cacheStats
  });
  const result = resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations,
    enableGraph: false,
    cache,
    cacheStats,
    fileHashes,
    mode: 'code'
  });
  return { result, cacheStats };
};

{
  const cache = {};
  const importsByFile = {
    'src/a.js': ['./shared.js'],
    'src/b.js': ['./shared.js'],
    'src/c.js': ['./other.js']
  };
  const firstRelations = new Map([
    ['src/a.js', { imports: ['./shared.js'] }],
    ['src/b.js', { imports: ['./shared.js'] }],
    ['src/c.js', { imports: ['./other.js'] }]
  ]);
  runResolution({
    cache,
    entries: buildEntries({ includeShared: true }),
    importsByFile,
    fileRelations: firstRelations
  });

  await fs.rm(path.join(srcRoot, 'shared.js'));
  const secondRelations = new Map([
    ['src/a.js', { imports: ['./shared.js'] }],
    ['src/b.js', { imports: ['./shared.js'] }],
    ['src/c.js', { imports: ['./other.js'] }]
  ]);
  const second = runResolution({
    cache,
    entries: buildEntries({ includeShared: false }),
    importsByFile,
    fileRelations: secondRelations
  });
  const relA = secondRelations.get('src/a.js');
  const relB = secondRelations.get('src/b.js');
  const relC = secondRelations.get('src/c.js');

  assert.equal(second.cacheStats.fileSetInvalidated, true, 'expected file-set diff invalidation');
  assert.equal(second.cacheStats.fileSetDelta?.removed, 1, 'expected removed-file count in telemetry');
  assert.ok(
    (second.cacheStats.filesNeighborhoodInvalidated || 0) >= 2,
    'expected dependency neighborhood invalidation for shared importers'
  );
  assert.equal(second.cacheStats.filesReused, 1, 'expected unaffected importer to stay reused');
  assert.deepEqual(relA.importLinks, [], 'expected shared import invalidated for src/a.js');
  assert.deepEqual(relB.importLinks, [], 'expected shared import invalidated for src/b.js');
  assert.deepEqual(relC.importLinks, ['src/other.js'], 'expected unrelated importer to remain resolved');
}

{
  const cache = {};
  await fs.writeFile(path.join(srcRoot, 'main.js'), "import './later.js';\n");
  const importsByFile = { 'src/main.js': ['./later.js'] };
  const firstRelations = new Map([['src/main.js', { imports: ['./later.js'] }]]);
  runResolution({
    cache,
    entries: [{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }],
    importsByFile,
    fileRelations: firstRelations
  });
  assert.deepEqual(
    firstRelations.get('src/main.js')?.importLinks || [],
    [],
    'expected unresolved import before added target exists'
  );

  await fs.writeFile(path.join(srcRoot, 'later.js'), 'export const later = true;\n');
  const secondRelations = new Map([['src/main.js', { imports: ['./later.js'] }]]);
  const second = runResolution({
    cache,
    entries: buildEntries({ includeShared: false, includeLater: true }).concat([
      { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
    ]),
    importsByFile,
    fileRelations: secondRelations
  });
  assert.deepEqual(
    secondRelations.get('src/main.js')?.importLinks || [],
    ['src/later.js'],
    'expected stale unresolved cache entry to refresh when target file is added'
  );
  assert.ok(
    (second.cacheStats.staleEdgeInvalidated || 0) >= 1,
    'expected stale-edge detector to invalidate unresolved relative importer'
  );
}

{
  const cache = {};
  fileHashes.set('src/cap-one.js', 'hash-cap-one');
  fileHashes.set('src/cap-two.js', 'hash-cap-two');
  await fs.writeFile(path.join(srcRoot, 'cap-one.js'), "import './cap-target.js';\n");
  await fs.writeFile(path.join(srcRoot, 'cap-two.js'), "import './cap-target.js';\n");
  const importsByFile = {
    'src/cap-one.js': ['./cap-target.js'],
    'src/cap-two.js': ['./cap-target.js']
  };
  const firstRelations = new Map([
    ['src/cap-one.js', { imports: ['./cap-target.js'] }],
    ['src/cap-two.js', { imports: ['./cap-target.js'] }]
  ]);
  runResolution({
    cache,
    entries: [
      { abs: path.join(srcRoot, 'cap-one.js'), rel: 'src/cap-one.js' },
      { abs: path.join(srcRoot, 'cap-two.js'), rel: 'src/cap-two.js' }
    ],
    importsByFile,
    fileRelations: firstRelations
  });

  await fs.writeFile(path.join(srcRoot, 'cap-target.js'), 'export const cap = true;\n');
  const secondRelations = new Map([
    ['src/cap-one.js', { imports: ['./cap-target.js'] }],
    ['src/cap-two.js', { imports: ['./cap-target.js'] }]
  ]);
  const second = runResolution({
    cache,
    entries: [
      { abs: path.join(srcRoot, 'cap-one.js'), rel: 'src/cap-one.js' },
      { abs: path.join(srcRoot, 'cap-two.js'), rel: 'src/cap-two.js' },
      { abs: path.join(srcRoot, 'cap-target.js'), rel: 'src/cap-target.js' }
    ],
    importsByFile,
    fileRelations: secondRelations,
    maxStaleEdgeChecks: 1
  });
  const capResolvedLinks = (
    (secondRelations.get('src/cap-one.js')?.importLinks?.length || 0)
    + (secondRelations.get('src/cap-two.js')?.importLinks?.length || 0)
  );
  assert.equal(capResolvedLinks, 1, 'expected stale-edge cap to limit invalidation to one unresolved importer');
  assert.equal(second.cacheStats.staleEdgeChecks, 1, 'expected stale-edge check counter to honor configured cap');
  assert.equal(second.cacheStats.staleEdgeBudgetExhausted, true, 'expected stale-edge cap exhaustion telemetry');
}

{
  const cache = {};
  const pyRoot = path.join(tempRoot, 'python', 'service');
  await fs.mkdir(path.join(pyRoot, 'proto'), { recursive: true });
  await fs.writeFile(path.join(pyRoot, 'main.py'), 'from .proto import client_pb2\n');
  fileHashes.set('python/service/main.py', 'hash-python-main');
  const importsByFile = {
    'python/service/main.py': ['./proto/client_pb2.py']
  };
  const firstRelations = new Map([
    ['python/service/main.py', { imports: ['./proto/client_pb2.py'] }]
  ]);
  const first = runResolution({
    cache,
    entries: [
      { abs: path.join(pyRoot, 'main.py'), rel: 'python/service/main.py' }
    ],
    importsByFile,
    fileRelations: firstRelations
  });
  assert.equal(first.result?.unresolvedSamples?.[0]?.reasonCode, 'IMP_U_MISSING_FILE_RELATIVE');

  await fs.writeFile(path.join(pyRoot, 'proto', 'client.proto'), 'syntax = "proto3";\n');
  const secondRelations = new Map([
    ['python/service/main.py', { imports: ['./proto/client_pb2.py'] }]
  ]);
  const second = runResolution({
    cache,
    entries: [
      { abs: path.join(pyRoot, 'main.py'), rel: 'python/service/main.py' },
      { abs: path.join(pyRoot, 'proto', 'client.proto'), rel: 'python/service/proto/client.proto' }
    ],
    importsByFile,
    fileRelations: secondRelations
  });
  assert.equal(
    second.result?.unresolvedSamples?.[0]?.reasonCode,
    'IMP_U_GENERATED_EXPECTED_MISSING',
    'expected unresolved reason to reclassify after generated counterpart source appears'
  );
  assert.ok(
    (second.cacheStats.staleEdgeInvalidated || 0) >= 1,
    'expected generated counterpart stale-edge invalidation'
  );
}

console.log('import cache neighborhood invalidation test passed');
