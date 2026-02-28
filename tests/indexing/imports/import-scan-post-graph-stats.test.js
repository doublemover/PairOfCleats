#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { postScanImports } from '../../../src/index/build/indexer/steps/relations/import-scan.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-post-graph-stats');
const srcRoot = path.join(tempRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), "import './missing.js';\n", 'utf8');

const state = new Map([['src/main.js', { imports: ['./missing.js'] }]]);
const stageState = {
  fileRelations: state,
  importResolutionGraph: null
};
const timing = {};
const result = await postScanImports({
  mode: 'code',
  relationsEnabled: true,
  scanPlan: {
    importScanMode: 'pre',
    enableImportLinks: true,
    shouldScan: true,
    importGraphEnabled: true
  },
  state: stageState,
  timing,
  runtime: {
    root: tempRoot,
    toolInfo: { version: 'test' },
    indexingConfig: {
      importResolution: {}
    }
  },
  entries: [
    { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
  ],
  importResult: {
    importsByFile: {
      'src/main.js': ['./missing.js']
    },
    durationMs: 0,
    stats: null
  },
  incrementalState: null,
  fileTextByFile: null,
  hangProbeConfig: null,
  abortSignal: null
});

assert.equal(result?.unresolvedTaxonomy?.total, 1);
assert.equal(result?.unresolvedTaxonomy?.actionable, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.unresolvedTaxonomy?.resolverStages || {})),
  { filesystem_probe: 1 }
);
assert.deepEqual(
  result?.unresolvedTaxonomy?.actionableHotspots || [],
  [{ importer: 'src/main.js', count: 1 }]
);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.stats?.unresolvedByReasonCode || {})),
  { IMP_U_MISSING_FILE_RELATIVE: 1 }
);
assert.deepEqual(
  Object.fromEntries(Object.entries(stageState?.importResolutionGraph?.stats?.unresolvedByResolverStage || {})),
  { filesystem_probe: 1 }
);
assert.deepEqual(
  stageState?.importResolutionGraph?.stats?.unresolvedActionableHotspots || [],
  [{ importer: 'src/main.js', count: 1 }]
);

console.log('import scan post graph stats test passed');
