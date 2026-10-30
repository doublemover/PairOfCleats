import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createWorkspaceMethodHealth } from '../../../../src/integrations/tooling/providers/lsp/workspace-method-health.js';
import { createToolingGuard } from '../../../../src/integrations/tooling/providers/shared.js';
import { sleep } from '../../../../src/shared/sleep.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../../helpers/execution-authority.js';
import { addStorageFailureContext } from '../../../../src/shared/storage/operation-error.js';

applyTestEnv();
const [root, phase, clockText] = process.argv.slice(2), now = Number(clockText);
if (phase.startsWith('collector-')) {
  const restore = grantFixtureRepositoryExecution(root), requests = Object.create(null);
  globalThis.__workspaceHealthClient = () => {
    let running = true;
    return { getGeneration: () => 1, isTransportRunning: () => running,
      initialize: async () => ({ capabilities: { documentSymbolProvider: true, hoverProvider: true } }),
      notify() {},
      request: async method => {
        requests[method] = (requests[method] || 0) + 1;
        if (method === 'textDocument/documentSymbol') return [{ name: 'greet', kind: 12, detail: 'function greet(name)',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 36 } },
          selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } } }];
        if (method === 'textDocument/hover') throw Object.assign(new Error('LSP request timeout'), { code: 'ERR_LSP_REQUEST_TIMEOUT' });
        throw new Error('Unexpected fixture method: ' + method);
      },
      getMetrics: () => ({ byMethod: Object.fromEntries(Object.entries(requests).map(([method, count]) => [method,
        { requested: count, failed: method === 'textDocument/hover' ? count : 0, timedOut: method === 'textDocument/hover' ? count : 0 }])) }),
      shutdownAndExit: async () => { running = false; }, kill: async () => { running = false; return { settled: true, exitObserved: true }; },
      getTerminationEvidence: () => ({ settled: !running, exitObserved: !running, pending: running }),
      waitForResourceSettlement: async () => ({ settled: !running, exitObserved: !running }),
      releaseManagedInstallation: async () => true };
  };
  const hook = registerHooks({ load(url, context, next) {
    if (url.endsWith('/integrations/tooling/lsp/managed-client.js')) return { format: 'module', shortCircuit: true,
      source: 'export const createRetainedLspClient = () => globalThis.__workspaceHealthClient();' };
    return next(url, context);
  } });
  let collectorReport, collectorFailure, collectorFailed = false;
  try {
    const { collectLspTypes } = await import('../../../../src/integrations/tooling/providers/lsp.js');
    const text = await fs.readFile(path.join(root, 'source.lua'), 'utf8');
    const chunkUid = 'ck64:v1:test:lua:durable-health';
    const collect = () => collectLspTypes({ rootDir: root, workspaceRootDir: root, workspaceKey: 'fixture-workspace',
      providerId: 'fixture-lua-health', cmd: path.join(root, 'inert-runtime.exe'), args: [],
      documents: [{ virtualPath: 'source.lua', text, languageId: 'lua', effectiveExt: '.lua' }],
      targets: [{ virtualPath: 'source.lua', virtualRange: { start: 0, end: 36 }, languageId: 'lua',
        chunkRef: { chunkUid, chunkId: 'greet', file: 'source.lua', range: { start: 0, end: 36 } } }],
      cacheRoot: path.join(root, 'cache'), workspaceHealthContext: { configHash: 'fixture', providerVersion: '1', configFileNames: ['.luarc.json'] },
      sessionPoolingEnabled: phase === 'collector-same-process', retries: 2, breakerThreshold: 3, documentSymbolConcurrency: 1, hoverConcurrency: 1,
      hoverDisableAfterTimeouts: 1, hoverRequireMissingReturn: false, strict: false,
      parseSignature: () => ({ signature: 'greet(name)', paramNames: ['name'] }), log: () => {} });
    let output = await collect();
    if (phase === 'collector-same-process') { assert.equal(requests['textDocument/hover'], 1); output = await collect(); }
    assert.equal(requests['textDocument/documentSymbol'], phase === 'collector-same-process' ? 2 : 1);
    assert.equal(Object.keys(output.byChunkUid).length, 1, 'healthy documentSymbol output contributes through the actual collector');
    if (phase === 'collector-record') {
      assert.equal(requests['textDocument/hover'], 1); assert.ok(output.runtime.workspaceHealth.publishedWrites > 0);
    } else {
      assert.equal(requests['textDocument/hover'] || 0, phase === 'collector-same-process' ? 1 : 0);
      assert.ok(output.runtime.workspaceHealth.preAdmissionMethods.includes('hover'));
      assert.equal(output.runtime.workspaceHealth.byMethod.hover.reusedHealth, true);
      assert.ok(output.checks.some(check => check.name === 'tooling_workspace_method_deferred'));
    }
    collectorReport = { phase, requests, metrics: output.runtime.workspaceHealth };
  } catch (error) { collectorFailure = error; collectorFailed = true; }
  finally {
    try {
      const { drainLspSessionPool } = await import('../../../../src/integrations/tooling/providers/lsp/session-pool.js');
      assert.equal((await drainLspSessionPool()).status, 'ok');
    } catch (error) {
      collectorFailure = collectorFailed ? addStorageFailureContext(collectorFailure, {}, error, { secondaryPresent: true }) : error;
      collectorFailed = true;
    }
    hook.deregister(); restore(); delete globalThis.__workspaceHealthClient;
  }
  if (collectorFailed) throw collectorFailure;
  console.log(JSON.stringify(collectorReport));
  process.exitCode = 0;
} else {
  const owner = await createWorkspaceMethodHealth({ repoRoot: root, workspaceRoot: root,
    providerId: 'fixture-lua-health', workspaceKey: 'fixture-workspace', providerVersion: '1',
    command: path.join(root, 'inert-runtime.exe'), args: [], environment: { FIXTURE: 'stable' },
    documents: [{ virtualPath: 'source.lua', text: await fs.readFile(path.join(root, 'source.lua'), 'utf8'), languageId: 'lua' }],
    initializationOptions: null, configFileNames: ['.luarc.json'], policy: { fixture: true },
    cacheRoot: path.join(root, 'cache'), timeoutThreshold: 1, now: () => now });
  const guard = createToolingGuard({ name: 'fixture-method-health', retries: 2, breakerThreshold: 3 });
  let calls = 0;
  const run = (method, operation) => guard.run(parameters => owner.run(method, operation,
    { retriesRemaining: parameters.retriesRemaining }), { label: method });
  if (phase === 'record') {
    await assert.rejects(run('hover', () => { calls++; throw Object.assign(new Error('LSP request timeout'), { code: 'ERR_LSP_REQUEST_TIMEOUT' }); }));
    assert.equal(calls, 1); assert.equal(owner.metrics().publishedWrites, 1);
    assert.equal(owner.metrics().withheldRetryAllowance, 2); assert.equal(guard.getState().consecutiveFailures, 0);
    assert.equal(guard.getState().lastFailure.scope, 'method');
  } else if (phase === 'reuse') {
    assert.equal(owner.suppressBeforeAdmission('hover'), true);
    await assert.rejects(run('hover', () => { calls++; return null; }), { code: 'TOOLING_METHOD_COOLDOWN' });
    assert.equal(calls, 0); assert.equal(guard.getState().consecutiveFailures, 0);
    assert.deepEqual(await run('documentSymbol', () => { calls++; return []; }), []);
    assert.equal(calls, 1); assert.equal(owner.metrics().byMethod.hover.reusedHealth, true);
  } else if (phase === 'probe' || phase === 'probe-gate') {
    const operation = async () => {
      calls++;
      if (phase === 'probe-gate') {
        await fs.writeFile(path.join(root, 'probe-ready'), 'ready');
        const started = Date.now();
        for (;;) {
          try { await fs.stat(path.join(root, 'probe-release')); break; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (Date.now() - started > 2500) throw new Error('Controlled probe release exceeded its fixture boundary.');
          await sleep(10);
        }
      }
      return { contents: 'function greet(name)' };
    };
    try {
      await run('hover', operation);
      assert.equal(calls, 1); assert.equal(owner.metrics().recoveryProbes, 1);
    } catch (error) {
      assert.equal(phase, 'probe'); assert.equal(error.code, 'TOOLING_METHOD_COOLDOWN'); assert.equal(calls, 0);
    }
  } else throw new Error('Unknown workspace-health fixture phase.');
  console.log(JSON.stringify({ phase, calls, metrics: owner.metrics() }));
}
