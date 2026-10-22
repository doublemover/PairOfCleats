import assert from 'node:assert/strict';
import { createLspObservationCollector } from '../../../src/integrations/tooling/providers/lsp/structured-observations.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createDiagnosticsCollector } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';
import { probeLspCapabilities, buildLspCapabilityGate } from '../../../src/integrations/tooling/providers/lsp/capabilities.js';

const text = '😀 value\nchild';
const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'structured-lsp-fixture', path: 'input.lua', language: 'lua' }).manifest;
const uri = 'file:///fixture/input.lua';
const identity = { sessionId: 'fixture-session', profileId: 'fixture-profile', sourceHash: source.byteHash,
  sourceUnitId: source.sourceUnitId, contextHash: 'a'.repeat(64), generation: { baseBuildId: 'fixture', semanticRevision: 0 }, uri };
const range = { start: { line: 0, character: 3 }, end: { line: 0, character: 8 } };
const sourceForUri = target => target === uri ? { source, text } : null;
const options = { identity, consumers: ['navigation', 'symbolDetail', 'hierarchyDetail'], sourceForUri, projectReady: 'ready' };
const collector = createLspObservationCollector(options);
const symbols = collector.record({ requestClass: 'documentSymbol', params: { textDocument: { uri } }, response: {
  attempted: true, payload: [{ name: 'value', kind: 12, range, selectionRange: range,
    children: [{ name: 'child', kind: 13, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } } }] }]
} });
assert.equal(symbols.facts[1].parent, 0);
assert.equal(symbols.facts[0].protocolShape, 'DocumentSymbol');
assert.deepEqual(symbols.facts[0].target.span, [3, 8]);
const flat = collector.record({ requestClass: 'documentSymbol', params: { textDocument: { uri }, query: 'flat' },
  response: { attempted: true, payload: [{ name: 'value', kind: 12, containerName: 'display-only', location: { uri, range } }] } });
assert.equal(flat.facts[0].parent, null);
assert.equal(flat.facts[0].protocolShape, 'SymbolInformation');
const external = collector.record({ requestClass: 'definition', params: { textDocument: { uri }, position: range.start },
  response: { attempted: true, payload: [{ targetUri: 'https://example.invalid/source', targetRange: range,
    targetSelectionRange: range, originSelectionRange: range }] } });
assert.equal(external.facts[0].target.state, 'external');
assert.equal(external.state, 'partial');
assert.equal(external.facts[0].protocolShape, 'LocationLink');
const signature = collector.record({ requestClass: 'references', params: { textDocument: { uri }, position: range.start, context: { includeDeclaration: false } },
  response: { attempted: true, info: { signature: 'display only' } } });
assert.equal(signature.reason, 'raw_payload_unavailable');
const splitScalar = collector.record({ requestClass: 'definition', params: { textDocument: { uri }, position: { line: 0, character: 0 } },
  response: { attempted: true, payload: [{ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] } });
assert.equal(splitScalar.facts[0].target.state, 'invalid_range', 'UTF16 code-unit roundtrip does not make a split scalar an exact source range');
assert.equal(splitScalar.facts[0].target.span, null);
assert.equal(splitScalar.exactCount, 0);
assert.equal(splitScalar.state, 'partial');
let requests = 0;
const item = { name: 'value', kind: 12, uri, range, selectionRange: range, data: { opaque: 'keep-exact' } };
const budgets = Object.fromEntries(['prepareCallHierarchy', 'outgoingCalls'].map(key => [key, { tryReserve: () => true }]));
const hierarchy = createLspObservationCollector({ ...options,
  capabilities: { prepareCallHierarchy: true, outgoingCalls: true }, requestBudgets: budgets,
  request: async (method, params) => { requests += 1; if (method === 'textDocument/prepareCallHierarchy') return [item];
    assert.deepEqual(params.item.data, item.data); return [{ to: item, fromRanges: [range] }]; } });
const request = { requestClass: 'prepareCallHierarchy', params: { textDocument: { uri }, position: range.start } };
const [prepared, duplicate] = await Promise.all([hierarchy.acquire(request), hierarchy.acquire(request)]);
assert.equal(requests, 1, 'concurrent fact consumers share the actual request');
assert.deepEqual(prepared, duplicate);
const token = prepared.facts[0].itemToken;
const outgoing = await hierarchy.hierarchy({ itemToken: token, requestClass: 'outgoingCalls' });
await hierarchy.hierarchy({ itemToken: token, requestClass: 'outgoingCalls' });
assert.equal(requests, 2, 'opaque hierarchy cycle reuses the same scoped observation');
assert.equal(outgoing.facts[0].completeness, 'provider_observation');
assert.equal((await hierarchy.hierarchy({ itemToken: token, requestClass: 'outgoingCalls', depth: 17 })).state, 'partial');
const unsupported = await hierarchy.acquire({ requestClass: 'typeDefinition', params: { textDocument: { uri }, position: range.start } });
assert.equal(unsupported.state, 'unsupported');
assert.equal(unsupported.coverage, 'unknown');
let current = true, release;
const changed = createLspObservationCollector({ ...options, capabilities: { definition: true }, requestBudgets: { definition: { tryReserve: () => true } },
  isCurrent: () => current, request: () => new Promise(resolve => { release = resolve; }) });
const late = changed.acquire({ requestClass: 'definition', params: { textDocument: { uri }, position: range.start } });
current = false; release([{ uri, range }]);
await assert.rejects(late, { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
assert.equal(changed.observations().length, 0);
const diagnostics = createDiagnosticsCollector({ captureDiagnostics: true, checks: [], checkFlags: {}, maxDiagnosticUris: 2,
  maxDiagnosticsPerUri: 2, requireOwnedDocuments: true });
diagnostics.registerDocument(uri, 3);
assert.equal(diagnostics.getEvidenceForUri(uri).observed, false);
diagnostics.onNotification({ method: 'textDocument/publishDiagnostics', params: { uri, version: 2, diagnostics: [] } });
assert.equal(diagnostics.getEvidenceForUri(uri).observed, false, 'stale diagnostics do not prove an empty current result');
diagnostics.onNotification({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
assert.equal(diagnostics.getEvidenceForUri(uri).versionState, 'unknown');
const mask = probeLspCapabilities({ capabilities: { callHierarchyProvider: true, typeHierarchyProvider: true } });
assert.equal(mask.prepareCallHierarchy, true);
assert.equal(buildLspCapabilityGate({ capabilityMask: mask }).requested.incomingCalls, false, 'hierarchy never becomes a default request sweep');
assert.equal(buildLspCapabilityGate({ capabilityMask: mask, structuredRequestClasses: ['incomingCalls'] }).effective.incomingCalls, true);
const failures = createLspObservationCollector({ ...options, maxRequests: 2, maxBytes: 8192 });
for (let index = 0; index < 3; index += 1) {
  const result = failures.record({ requestClass: 'definition', params: { textDocument: { uri }, position: { line: 0, character: index } },
    response: { attempted: true, error: { code: 'X'.repeat(2048), message: 'E'.repeat(16384) } } });
  if (index < 2) {
    assert.equal(result.error.code.length, 128);
    assert.equal(result.error.message.length, 1024);
    assert.ok(Object.isFrozen(result));
  } else assert.equal(result.reason, 'observation_budget');
}
assert.equal(failures.observations().length, 2, 'failed responses consume the same bounded observation inventory');
assert.ok(failures.metrics().bytes <= 8192);
console.log('structured LSP observations, hierarchy scope, raw request reuse and diagnostics versions');
