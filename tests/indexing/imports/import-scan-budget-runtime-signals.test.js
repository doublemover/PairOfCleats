#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { postScanImports } from '../../../src/index/build/indexer/steps/relations/import-scan.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-budget-runtime-signals');
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
const runtime = {
  root: tempRoot,
  toolInfo: { version: 'test' },
  indexingConfig: {
    importResolution: {}
  },
  scheduler: {
    stats: () => ({
      utilization: { overall: 0.4 },
      activity: { pending: 160, running: 3 },
      adaptive: {
        signals: {
          memory: { pressureScore: 0.95 },
          fd: { pressureScore: 0.2 }
        }
      }
    })
  },
  envelope: {
    concurrency: {
      cpuConcurrency: { value: 8 },
      ioConcurrency: { value: 8 }
    }
  }
};

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
  runtime,
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

assert.equal(result?.stats?.resolverBudgetPolicy?.adaptiveEnabled, true);
assert.equal(result?.stats?.resolverBudgetPolicy?.adaptiveProfile, 'pressure_critical');
assert.equal(result?.stats?.resolverBudgetPolicy?.maxFilesystemProbesPerSpecifier, 16);
assert.equal(result?.stats?.resolverBudgetPolicy?.maxFallbackCandidatesPerSpecifier, 24);
assert.equal(result?.stats?.resolverBudgetPolicy?.maxFallbackDepth, 12);
assert.equal(stageState?.importResolutionGraph?.stats?.resolverBudgetPolicy?.adaptiveProfile, 'pressure_critical');

console.log('import scan budget runtime signals test passed');
