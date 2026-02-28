#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'imports-stage-cache-hit-miss');
const srcRoot = path.join(tempRoot, 'src');
const importerAbs = path.join(srcRoot, 'main.js');
const importerRel = 'src/main.js';

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(importerAbs, "import './missing.js';\n", 'utf8');

const entries = [{ abs: importerAbs, rel: importerRel }];
const importsByFile = {
  [importerRel]: ['./missing.js']
};

const makeRelations = () => new Map([[importerRel, { imports: ['./missing.js'] }]]);
const cache = {};
const fileHashes = new Map([[importerRel, 'hash-main-v1']]);

const first = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: makeRelations(),
  cache,
  fileHashes,
  enableGraph: true
});
const firstStages = first?.stats?.resolverPipelineStages || {};
assert.equal(
  (firstStages.language_resolver?.attempts || 0) >= 1,
  true,
  'expected first run to execute language resolver stage'
);
assert.equal(
  (firstStages.filesystem_probe?.attempts || 0) >= 1,
  true,
  'expected first run to execute filesystem probe stage'
);
assert.equal(
  (first?.cacheStats?.specsComputed || 0) >= 1,
  true,
  'expected first run to compute spec resolution'
);

const second = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: makeRelations(),
  cache,
  fileHashes,
  enableGraph: true
});
const secondStages = second?.stats?.resolverPipelineStages || {};
assert.equal(
  second?.cacheStats?.specsReused >= 1,
  true,
  'expected second run to reuse cached spec resolution'
);
assert.equal(
  second?.cacheStats?.specsComputed || 0,
  0,
  'expected second run to avoid recomputing cached specs'
);
assert.equal(
  secondStages.language_resolver?.attempts || 0,
  0,
  'expected cache hit to skip language resolver stage'
);
assert.equal(
  secondStages.filesystem_probe?.attempts || 0,
  0,
  'expected cache hit to skip filesystem probe stage'
);
assert.equal(
  secondStages.classify?.attempts || 0,
  1,
  'expected unresolved decision classification to still run once'
);

const unresolved = Array.isArray(second?.unresolvedSamples) ? second.unresolvedSamples : [];
assert.equal(unresolved.length, 1, 'expected cached unresolved warning to persist');
assert.equal(unresolved[0]?.reasonCode, 'IMP_U_MISSING_FILE_RELATIVE');

console.log('import resolution stage cache hit miss test passed');
