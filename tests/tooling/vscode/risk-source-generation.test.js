import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const require = createRequire(import.meta.url);
const { resolveRiskSource, validateRiskSource } = require('../../../extensions/vscode/risk-source.js');
const { normalizeWorkflowRequest } = require('../../../extensions/vscode/workflow-replay.js');
const repoRoot = createVsCodeRuntimeTempRepo({ prefix: 'risk-source-generation-' });
const cache = path.join(repoRoot, 'external-configured-cache');
const selected = path.join(cache, 'code-only-build', 'index-code');
const old = path.join(repoRoot, 'index-code');
for (const dir of [selected, old]) {
  fs.mkdirSync(path.join(dir, 'pieces'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pieces', 'manifest.json'), '{}');
}
const sourcePayload = { primary: { ref: { chunkUid: 'chunk-current' } },
  provenance: { repo: '.', indexDir: path.relative(repoRoot, selected), indexSignature: 'selected-code-generation' } };
const harness = createVsCodeRuntimeHarness({ repoRoot, configValues: { cliPath: './bin/pairofcleats.js' } });
try {
  harness.activate();
  const spec = harness.extension._test.OPERATOR_COMMAND_SPECS.find(item => item.id === 'pairofcleats.riskExplain');
  for (const seed of ['chunk:chunk-current', 'file:src/app.ts', 'symbol:App']) {
    harness.queuedResults.push({ code: 0, stdout: JSON.stringify(sourcePayload) });
    const resolved = await harness.extension._test.resolveRiskExplainSeedContext({
      repoContext: { repoRoot }, cliResolution: { command: process.execPath, argsPrefix: [] },
      seed, output: harness.extension._test.getOutputChannel()
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.indexDir, selected);
    assert.equal(resolved.chunkUid, 'chunk-current');
    const seedArgs = harness.spawnCalls.at(-1).args;
    assert.equal(seedArgs[seedArgs.indexOf('--seed') + 1], seed);
    const input = { seed, chunkUid: resolved.chunkUid, indexDir: resolved.indexDir,
      sourceQualification: resolved.sourceQualification, maxFlows: 3, presentationMode: 'output' };
    const request = normalizeWorkflowRequest({ version: 1, inputContext: input });
    assert.deepEqual(request.inputContext.sourceQualification, resolved.sourceQualification);
    assert.equal(validateRiskSource(input, repoRoot), null);
    harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ chunk: { chunkUid: 'chunk-current' }, flows: [] }) });
    await harness.extension._test.runOperatorCommand(spec, { repoContext: { ok: true, repoRoot }, inputContext: input });
    const args = harness.spawnCalls.at(-1).args;
    assert.equal(args[args.indexOf('--index') + 1], selected);
    assert.ok(!args.includes(old), 'stale repo-local artifacts never establish authority');
  }
  assert.throws(() => resolveRiskSource({ indexDir: old, primary: sourcePayload.primary }, { repoRoot, seed: 'chunk:x' }), /qualified/);
  assert.throws(() => resolveRiskSource({ ...sourcePayload, provenance: { ...sourcePayload.provenance, repo: '../different' } },
    { repoRoot, seed: 'chunk:x' }), /qualified/);
  assert.throws(() => resolveRiskSource({ ...sourcePayload, primary: {} }, { repoRoot, seed: 'chunk:absent' }), /no chunk/);
  const retained = { ...resolveRiskSource(sourcePayload, { repoRoot, seed: 'chunk:chunk-current' }), maxFlows: 3 };
  fs.rmSync(selected, { recursive: true, force: true });
  const before = harness.spawnCalls.length;
  await harness.extension._test.runOperatorCommand(spec, { repoContext: { ok: true, repoRoot }, inputContext: retained });
  assert.equal(harness.spawnCalls.length, before, 'missing retained generation never silently retries current');
  assert.match(harness.errorMessages.at(-1), /no longer available.*deliberately/);
} finally {
  harness.restoreGlobals();
  fs.rmSync(repoRoot, { recursive: true, force: true });
}
console.log('Editor risk source resolution and replay retain the canonical selected generation.');
