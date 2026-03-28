#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import {
  getLspProviderDelta,
  listDefaultEnabledLspProviderIds,
  listLspProviderDeltas
} from '../../../src/index/tooling/lsp-provider-deltas.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { listToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { createLspClient } from '../../../src/integrations/tooling/lsp/client.js';
import { createToolingGuard } from '../../../src/integrations/tooling/providers/shared.js';
import { createFramedJsonRpcParser, getJsonRpcWriter } from '../../../src/shared/jsonrpc.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.pid = 0;
    this.killed = false;
    this.exitCode = null;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }

  kill(signal = null) {
    this.killed = true;
    this.exitCode = this.exitCode === null ? 0 : this.exitCode;
    queueMicrotask(() => {
      this.emit('exit', this.exitCode, signal);
      this.emit('close', this.exitCode, signal);
    });
    return true;
  }

  unref() {}
}

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const runMetricsAggregateCases = async () => {
  const tempRoot = resolveTestCachePath(root, `lsp-metrics-contract-${process.pid}-${Date.now()}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

  const cppText = 'int add(int a, int b) { return a + b; }\n';
  const dartText = 'String greet(String name) { return name; }\n';

  registerDefaultToolingProviders();
  const aggregate = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-test', 'dart'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'test',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'emit-fd-pressure-warning'],
          languages: ['cpp'],
          uriScheme: 'poc-vfs'
        }]
      },
      dart: {
        enabled: true,
        requireWorkspaceModel: false,
        cmd: 'dart-not-found'
      }
    },
    cache: { enabled: false }
  }, {
    documents: [{
      virtualPath: '.poc-vfs/src/sample.cpp#seg:metrics-aggregate.cpp',
      text: cppText,
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: 'hash-cpp-metrics-aggregate'
    }, {
      virtualPath: '.poc-vfs/src/sample.dart#seg:metrics-aggregate.dart',
      text: dartText,
      languageId: 'dart',
      effectiveExt: '.dart',
      docHash: 'hash-dart-metrics-aggregate'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample.cpp:metrics-aggregate',
        chunkId: 'chunk_metrics_cpp',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: cppText.length }
      },
      virtualPath: '.poc-vfs/src/sample.cpp#seg:metrics-aggregate.cpp',
      virtualRange: { start: 0, end: cppText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'cpp'
    }, {
      chunkRef: {
        docId: 1,
        chunkUid: 'ck64:v1:test:src/sample.dart:metrics-aggregate',
        chunkId: 'chunk_metrics_dart',
        file: 'src/sample.dart',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: dartText.length }
      },
      virtualPath: '.poc-vfs/src/sample.dart#seg:metrics-aggregate.dart',
      virtualRange: { start: 0, end: dartText.length },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'dart'
    }],
    kinds: ['types']
  });

  assert.equal(aggregate.metrics?.providersPlanned, 2);
  assert.equal(aggregate.metrics?.providersExecuted, 2);
  assert.equal(aggregate.metrics?.providersContributed, 1);
  assert.ok(aggregate.metrics?.preflights && typeof aggregate.metrics.preflights === 'object');
  assert.equal(Number(aggregate.metrics?.preflights?.total) >= 1, true);
  assert.equal(typeof aggregate.metrics?.preflights?.byPolicy, 'object');
  assert.equal(Number(aggregate.metrics?.preflights?.teardown?.timedOut || 0), 0);
  assert.equal(aggregate.metrics?.degradedProviderCount, 1);
  assert.equal(Number(aggregate.metrics?.degradedWarningChecks || 0) >= 1, true);
  assert.equal(Number(aggregate.metrics?.requests?.requests || 0) >= 1, true);
  assert.equal(Number(aggregate.metrics?.health?.fdPressureEvents || 0) >= 1, true);
  assert.equal(Number(aggregate.metrics?.health?.providersWithFdPressure || 0) >= 1, true);
  assert.equal(Number(aggregate.metrics?.health?.pooledProviders || 0) >= 1, true);
  assert.equal(aggregate.metrics?.capabilities?.providersWithCapabilitiesMask, 1);
  assert.equal(aggregate.metrics?.capabilities?.documentSymbol, 1);
  assert.equal(aggregate.metrics?.capabilities?.hover, 1);
  assert.equal(aggregate.metrics?.capabilities?.semanticTokens, 0);
  assert.equal(aggregate.metrics?.capabilities?.signatureHelp, 0);
  assert.equal(aggregate.metrics?.capabilities?.inlayHints, 0);
  assert.equal(aggregate.metrics?.capabilities?.definition, 0);
  assert.equal(aggregate.metrics?.capabilities?.typeDefinition, 0);
  assert.equal(aggregate.metrics?.capabilities?.references, 0);
  assert.ok(aggregate.metrics?.hover && typeof aggregate.metrics.hover === 'object');
  assert.equal(Number.isFinite(Number(aggregate.metrics?.hover?.requested)), true);
  assert.equal(Number.isFinite(Number(aggregate.metrics?.hover?.signatureHelpTimedOut)), true);
  assert.equal(Number.isFinite(Number(aggregate.metrics?.hover?.skippedByGlobalDisable)), true);
  assert.deepEqual(Object.keys(aggregate.metrics?.providerRuntime || {}), ['dart', 'lsp-test']);
  assert.equal(aggregate.metrics?.providerRuntime?.dart?.degraded?.active, true);
  assert.equal(aggregate.metrics?.providerRuntime?.['lsp-test']?.degraded?.active, false);
  assert.equal(aggregate.metrics?.providerRuntime?.['lsp-test']?.pooling?.enabled, true);
  assert.equal(aggregate.metrics?.providerRuntime?.['lsp-test']?.pooling?.sessionKeyPresent, true);
  assert.ok(aggregate.metrics?.providerRuntime?.['lsp-test']?.hover && typeof aggregate.metrics.providerRuntime['lsp-test'].hover === 'object');
  assert.equal(aggregate.metrics?.providerRuntime?.['lsp-test']?.capabilities?.documentSymbol, true);
  assert.ok(aggregate.diagnostics?.dart?.preflight && typeof aggregate.diagnostics.dart.preflight === 'object');
  assert.equal(typeof aggregate.diagnostics?.dart?.preflight?.preflightPolicy, 'string');

  const capabilityRollup = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-test'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'test',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'all-capabilities'],
          languages: ['cpp'],
          uriScheme: 'poc-vfs'
        }]
      }
    },
    cache: { enabled: false }
  }, {
    documents: [{
      virtualPath: '.poc-vfs/src/sample.cpp#seg:capability-rollup.cpp',
      text: cppText,
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: 'hash-cpp-capability-rollup'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample.cpp:capability-rollup',
        chunkId: 'chunk_metrics_cpp_capability',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: cppText.length }
      },
      virtualPath: '.poc-vfs/src/sample.cpp#seg:capability-rollup.cpp',
      virtualRange: { start: 0, end: cppText.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'cpp'
    }],
    kinds: ['types']
  });

  assert.equal(capabilityRollup.metrics?.capabilities?.providersWithCapabilitiesMask, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.documentSymbol, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.hover, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.semanticTokens, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.signatureHelp, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.inlayHints, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.definition, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.typeDefinition, 1);
  assert.equal(capabilityRollup.metrics?.capabilities?.references, 1);
  const providerCapabilities = capabilityRollup.metrics?.providerRuntime?.['lsp-test']?.capabilities || null;
  assert.equal(providerCapabilities?.definition, true);
  assert.equal(providerCapabilities?.typeDefinition, true);
  assert.equal(providerCapabilities?.references, true);
  assert.equal(providerCapabilities?.semanticTokens, true);
  assert.equal(providerCapabilities?.inlayHints, true);
  assert.equal(Number.isFinite(Number(capabilityRollup.metrics?.providerRuntime?.['lsp-test']?.hover?.requested)), true);

  const hoverTimeout = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-test'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'test',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'stall-signature-help-two-symbols'],
          languages: ['cpp'],
          uriScheme: 'poc-vfs',
          signatureHelpTimeoutMs: 1000,
          hoverDisableAfterTimeouts: 1,
          definitionEnabled: false,
          typeDefinitionEnabled: false,
          referencesEnabled: false
        }]
      }
    },
    cache: { enabled: false }
  }, {
    documents: [{
      virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
      text: 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n',
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: 'hash-cpp-hover-timeout-rollup'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample.cpp:hover-timeout-rollup',
        chunkId: 'chunk_metrics_cpp_timeout',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 4, end: 7 }
      },
      virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
      virtualRange: { start: 4, end: 7 },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: 'cpp'
    }, {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:src/sample.cpp:hover-timeout-rollup:sub',
        chunkId: 'chunk_metrics_cpp_timeout_sub',
        file: 'src/sample.cpp',
        segmentUid: null,
        segmentId: null,
        range: { start: 44, end: 47 }
      },
      virtualPath: '.poc-vfs/src/sample.cpp#seg:hover-timeout-rollup.cpp',
      virtualRange: { start: 44, end: 47 },
      symbolHint: { name: 'sub', kind: 'function' },
      languageId: 'cpp'
    }],
    kinds: ['types']
  });
  assert.equal(Number(hoverTimeout.metrics?.hover?.signatureHelpRequested || 0) >= 1, true);
  assert.equal(Number(hoverTimeout.metrics?.hover?.signatureHelpTimedOut || 0) >= 1, true);
  assert.equal(Number(hoverTimeout.metrics?.hover?.providersWithActivity || 0) >= 1, true);
  assert.equal(
    Number(hoverTimeout.metrics?.hover?.skippedByGlobalDisable || 0) >= 1
      || Number(hoverTimeout.metrics?.hover?.skippedByAdaptiveDisable || 0) >= 1,
    true
  );
  assert.equal(Number(hoverTimeout.metrics?.providerRuntime?.['lsp-test']?.hover?.signatureHelpTimedOut || 0) >= 1, true);
  assert.equal(
    Number(hoverTimeout.metrics?.providerRuntime?.['lsp-test']?.hover?.skippedByGlobalDisable || 0) >= 1
      || Number(hoverTimeout.metrics?.providerRuntime?.['lsp-test']?.hover?.skippedByAdaptiveDisable || 0) >= 1,
    true
  );
};

const runClientMetricsCacheCase = async () => {
  const client = createLspClient({
    cmd: 'fake-lsp',
    args: ['--stdio'],
    log: () => {},
    spawnProcess: () => {
      const child = new FakeChildProcess();
      const writer = getJsonRpcWriter(child.stdout);
      const outboundParser = createFramedJsonRpcParser({
        onMessage: (message) => {
          if (message?.method === 'initialize') {
            writer.write({
              jsonrpc: '2.0',
              id: message.id,
              result: { capabilities: { documentSymbolProvider: true } }
            });
            return;
          }
          if (message?.method === 'textDocument/documentSymbol') {
            writer.write({ jsonrpc: '2.0', id: message.id, result: [] });
          }
        }
      });
      child.stdin.on('data', (chunk) => outboundParser.push(chunk));
      return child;
    }
  });

  try {
    await client.initialize({
      rootUri: 'file:///fake',
      capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      timeoutMs: 1000
    });
    const snapshot1 = client.getMetrics();
    const snapshot2 = client.getMetrics();
    assert.equal(snapshot1, snapshot2);
    await client.request('textDocument/documentSymbol', {
      textDocument: { uri: 'file:///fake/sample.cpp' }
    }, { timeoutMs: 1000 });
    const snapshot3 = client.getMetrics();
    assert.notEqual(snapshot2, snapshot3);
    const snapshot4 = client.getMetrics();
    assert.equal(snapshot3, snapshot4);
    assert.equal(Number(snapshot4?.byMethod?.['textDocument/documentSymbol']?.requests || 0), 1);
  } finally {
    await Promise.resolve(client.kill());
  }
};

const runFailureAccountingCase = async () => {
  const guard = createToolingGuard({
    name: 'lsp-guard-test',
    retries: 1,
    breakerThreshold: 1,
    timeoutMs: 100,
    log: () => {}
  });

  let attempt = 0;
  await guard.run(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('first failure');
    return 'ok';
  });
  assert.equal(guard.isOpen(), false);

  await assert.rejects(() => guard.run(() => {
    throw new Error('target failure');
  }), /target failure/);
  assert.equal(guard.isOpen(), true);
};

const runProviderDeltaManifestCase = async () => {
  const policyPath = path.join(root, 'docs', 'tooling', 'lsp-default-enable-policy.json');
  const policy = JSON.parse(await fs.readFile(policyPath, 'utf8'));
  const policyIds = (Array.isArray(policy?.providers) ? policy.providers : [])
    .filter((entry) => entry?.defaultEnabled === true)
    .map((entry) => String(entry.id || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  const deltas = listLspProviderDeltas().sort((left, right) => left.id.localeCompare(right.id));
  const deltaIds = deltas.map((delta) => delta.id);
  assert.deepEqual(deltaIds, policyIds);
  assert.deepEqual(listDefaultEnabledLspProviderIds(), policyIds);

  registerDefaultToolingProviders();
  const providerIds = listToolingProviders({
    lsp: {
      enabled: true,
      servers: [
        { preset: 'gopls', languages: ['go'] },
        { preset: 'rust-analyzer', languages: ['rust'] },
        { preset: 'yaml-language-server', languages: ['yaml'] },
        { preset: 'lua-language-server', languages: ['lua'] },
        { preset: 'zls', languages: ['zig'] }
      ]
    }
  }).map((provider) => String(provider?.id || '').trim()).filter(Boolean);

  for (const delta of deltas) {
    assert.equal(Number.isFinite(Number(delta.requestBudgetWeight)), true);
    assert.equal(Number.isFinite(Number(delta.confidenceBias)), true);
    assert.equal(Array.isArray(delta.fallbackReasonHints) && delta.fallbackReasonHints.length > 0, true);
    assert.equal(Boolean(delta.adaptiveDocScope) || delta.workspaceChecks.length > 0 || delta.bootstrapChecks.length > 0, true);
    assert.deepEqual(getLspProviderDelta(delta.id)?.id, delta.id);
    if (delta.class === 'preset') {
      assert.ok(resolveLspServerPresetByKey(delta.id));
    } else {
      assert.equal(providerIds.includes(delta.id), true);
    }
  }
};

await runMetricsAggregateCases();
await runClientMetricsCacheCase();
await runFailureAccountingCase();
await runProviderDeltaManifestCase();

console.log('LSP metrics contract matrix test passed');
