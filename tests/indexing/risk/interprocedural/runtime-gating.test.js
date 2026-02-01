#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseBuildArgs } from '../../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../../src/index/build/runtime.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'risk-interprocedural-runtime');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = tempRoot;

const baseConfig = {
  indexing: {
    riskInterprocedural: {
      enabled: true,
      summaryOnly: false
    }
  }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(baseConfig, null, 2)
);

const defaults = parseBuildArgs([]).argv;
const runtime = await createBuildRuntime({ root: repoRoot, argv: defaults, rawArgv: [] });
assert.equal(runtime.riskInterproceduralEnabled, true, 'riskInterprocedural should enable when risk analysis is on');
assert.equal(runtime.analysisPolicy?.risk?.interprocedural, true, 'analysisPolicy should include interprocedural');

const disabledConfig = {
  indexing: {
    riskAnalysis: false,
    riskInterprocedural: { enabled: true }
  }
};
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(disabledConfig, null, 2)
);
const runtimeDisabled = await createBuildRuntime({ root: repoRoot, argv: defaults, rawArgv: [] });
assert.equal(runtimeDisabled.riskInterproceduralEnabled, false, 'riskInterprocedural should disable when risk analysis is off');

console.log('risk interprocedural runtime gating test passed');
