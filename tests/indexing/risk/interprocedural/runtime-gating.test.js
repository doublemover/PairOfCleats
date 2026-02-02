#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseBuildArgs } from '../../../../src/index/build/args.js';
import { createBuildRuntime } from '../../../../src/index/build/runtime.js';
import { buildIncrementalSignaturePayload } from '../../../../src/index/build/indexer/signatures.js';

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
const codeSignature = buildIncrementalSignaturePayload(runtime, 'code', null);
const proseSignature = buildIncrementalSignaturePayload(runtime, 'prose', null);
assert.equal(codeSignature.features.riskInterproceduralEnabled, true, 'code mode should enable interprocedural');
assert.equal(proseSignature.features.riskInterproceduralEnabled, false, 'non-code mode should disable interprocedural');
assert.equal(codeSignature.features.riskInterproceduralSummaryOnly, false, 'code mode summaryOnly should remain false');
assert.equal(proseSignature.features.riskInterproceduralSummaryOnly, false, 'non-code mode summaryOnly should be false');

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
const disabledSignature = buildIncrementalSignaturePayload(runtimeDisabled, 'code', null);
assert.equal(disabledSignature.features.riskInterproceduralEnabled, false, 'disabled interprocedural should remain off');

console.log('risk interprocedural runtime gating test passed');
