import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { registerHooks } from 'node:module';
import { createMcpTestReader } from '../../helpers/mcp-reader.js';

const key = Symbol.for('poc.test.domain-handler-transports');
globalThis[key] = { error: null, calls: 0 };
const targets = new Map([
  ['context-pack.js', ['buildCompositeContextPackPayload']],
  ['semantic-detail.js', ['runSemanticDetail']], ['semantic-find.js', ['runSemanticFind']],
  ['semantic-trace.js', ['runSemanticTrace']], ['semantic-explain.js', ['runSemanticExplain']],
  ['semantic-enrichment.js', ['runSemanticEnrichment']], ['graph-evidence.js', ['runGraphEvidence']],
  ['runtime-evidence.js', ['runRuntimeEvidenceLookup', 'runRuntimeFamilyDiscovery']],
  ['runtime-claims.js', ['runRuntimeCaptureComparison', 'runRuntimeDerivedClaimLookup']]
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const value = next(specifier, context);
    if (!context.parentURL?.includes('/tools/mcp/tools/handlers/')) return value;
    if (value.url.endsWith('/tools/mcp/tools/helpers.js')) return { url: 'poc:domain-repo-context', shortCircuit: true };
    if (context.parentURL.endsWith('/analysis.js')) {
      if (value.url.endsWith('/src/retrieval/cli-index.js')) return { url: 'poc:domain-index-root', shortCircuit: true };
      if (value.url.endsWith('/src/retrieval/cli/index-loader.js')) return { url: 'poc:domain-index-presence', shortCircuit: true };
      if (value.url.endsWith('/tools/analysis/explain-risk.js')) return { url: 'poc:domain-core:buildRiskExplainPayload', shortCircuit: true };
    }
    for (const [filename, names] of targets) if (value.url.endsWith('/src/integrations/tooling/' + filename))
      return { url: 'poc:domain-core:' + names.join(','), shortCircuit: true };
    return value;
  },
  load(url, context, next) {
    if (url === 'poc:domain-repo-context') return { format: 'module', shortCircuit: true,
      source: 'export * from ' + JSON.stringify(new URL('../../../tools/mcp/tools/helpers.js', import.meta.url).href)
        + ";export const resolveMcpRepoContext=()=>({repoPath:'/fixture',userConfig:{}});" };
    if (url === 'poc:domain-index-root') return { format: 'module', shortCircuit: true,
      source: "export const resolveIndexDir=()=>'/fixture-index';" };
    if (url === 'poc:domain-index-presence') return { format: 'module', shortCircuit: true,
      source: 'export const hasIndexMeta=()=>true;' };
    if (url.startsWith('poc:domain-core:')) return { format: 'module', shortCircuit: true,
      source: url.slice('poc:domain-core:'.length).split(',').map(name =>
        'export const ' + name + '=async()=>{const state=globalThis[Symbol.for("poc.test.domain-handler-transports")];state.calls++;throw state.error;};').join('\n') };
    return next(url, context);
  }
});
try {
  const analysis = await import('../../../tools/mcp/tools/handlers/analysis.js');
  const handlers = {
    context_pack: analysis.runContextPack, risk_explain: analysis.runRiskExplain,
    semantic_detail: (await import('../../../tools/mcp/tools/handlers/semantic.js')).runSemanticDetailTool,
    semantic_find: (await import('../../../tools/mcp/tools/handlers/semantic-find.js')).runSemanticFindTool,
    semantic_trace: (await import('../../../tools/mcp/tools/handlers/semantic-trace.js')).runSemanticTraceTool,
    semantic_explain: (await import('../../../tools/mcp/tools/handlers/semantic-explain.js')).runSemanticExplainTool,
    semantic_enrichment: (await import('../../../tools/mcp/tools/handlers/semantic-enrichment.js')).runSemanticEnrichmentTool,
    graph_evidence: (await import('../../../tools/mcp/tools/handlers/graph-evidence.js')).runGraphEvidenceTool,
    runtime_evidence: (await import('../../../tools/mcp/tools/handlers/runtime-evidence.js')).runRuntimeEvidenceTool
  };
  const cases = [];
  for (const name of ['semantic_detail', 'semantic_find', 'semantic_trace', 'semantic_explain'])
    for (const [code, expected] of [['ERR_SEMANTIC_QUERY_LIMIT', 'INVALID_REQUEST'],
      ['ERR_SEMANTIC_OUTPUT_LIMIT', 'INVALID_REQUEST'], ['ERR_SEMANTIC_SCOPE_MISMATCH', 'FORBIDDEN'],
      ['ERR_SEMANTIC_UNAVAILABLE', 'NO_INDEX'], ['ERR_SEMANTIC_CURSOR_EXPIRED', 'INVALID_REQUEST']])
      cases.push({ name, code, expected });
  for (const [code, expected] of [['ERR_SEMANTIC_ENRICHMENT_AUTHORITY', 'FORBIDDEN'],
    ['ERR_SEMANTIC_ENRICHMENT_STALE', 'INVALID_REQUEST'], ['ERR_SEMANTIC_ENRICHMENT_BUDGET', 'INVALID_REQUEST'],
    ['ERR_SEMANTIC_ENRICHMENT_FAILED', 'INTERNAL']]) cases.push({ name: 'semantic_enrichment', code, expected });
  for (const [code, expected] of [['ERR_GRAPH_EVIDENCE_CURSOR_SCOPE', 'INVALID_REQUEST'],
    ['ERR_GRAPH_EVIDENCE_PAGE_BYTES', 'INVALID_REQUEST'], ['ERR_GRAPH_EVIDENCE_GENERATION', 'INVALID_REQUEST'],
    ['ERR_GRAPH_EVIDENCE_PAGING_UNAVAILABLE', 'NO_INDEX']]) cases.push({ name: 'graph_evidence', code, expected });
  for (const [code, expected] of [['ERR_RUNTIME_DESTINATION_FORBIDDEN', 'FORBIDDEN'],
    ['ERR_RUNTIME_QUERY_SCOPE', 'INVALID_REQUEST'], ['ERR_RUNTIME_QUERY_CURSOR', 'INVALID_REQUEST'],
    ['ERR_RUNTIME_QUERY_BUDGET', 'INVALID_REQUEST']]) cases.push({ name: 'runtime_evidence', code, expected });
  cases.push({ name: 'context_pack', code: 'ERR_CONTEXT_PACK_STRICT_EVIDENCE', expected: 'INVALID_REQUEST' },
    { name: 'risk_explain', code: 'INVALID_REQUEST', expected: 'INVALID_REQUEST', reason: 'unknown_chunk_uid' },
    { name: 'risk_explain', code: 'MUST_NOT_REACH_CORE', expected: 'INVALID_REQUEST', noCore: true,
      overrides: { filters: { severity: ['impossible'] } } });
  const wirePayloads = [];
  for (const mode of ['legacy', 'sdk']) {
    const input = new PassThrough(), output = new PassThrough();
    const reader = createMcpTestReader(output, { transport: mode });
    const toolDefs = Object.keys(handlers).map(name => ({ name, inputSchema: { type: 'object' } }));
    const execute = (name, args, context) => handlers[name](args, context);
    const settings = { toolDefs, schemaVersion: '1.0.0', toolVersion: '1.0.0',
      serverInfo: { name: 'domain-handler-fixture', version: '1.0.0' }, queueMax: 8,
      resolveToolTimeoutMs: () => 1000, capabilities: {} };
    const service = mode === 'legacy'
      ? (await import('../../../tools/mcp/transport.js')).createMcpTransport({ ...settings,
        handleToolCall: execute, input, outputStream: output, exit: code => assert.equal(code, 0) })
      : await (await import('../../../tools/mcp/server-sdk.js')).startMcpSdkServer({ ...settings,
        executeTool: execute, stdin: input, stdout: output });
    const send = value => {
      const body = JSON.stringify(value);
      input.write(mode === 'legacy' ? 'Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body : body + '\n');
    };
    const read = async () => {
      let timer;
      try { return await Promise.race([reader.readMessage(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('bounded domain wire response did not settle')), 5000);
      })]); } finally { clearTimeout(timer); }
    };
    try {
      if (mode === 'legacy') service.start();
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05',
        capabilities: {}, clientInfo: { name: 'fixture', version: '1.0.0' } } });
      assert.ok((await read()).result);
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const values = [];
      for (const [index, current] of cases.entries()) {
        const error = Object.assign(new Error('controlled domain rejection'), { code: current.code,
          ...(current.reason ? { reason: current.reason } : {}),
          evidence: { complete: false, primary: { state: 'missing', missing: true } },
          details: { requested: 999, maximum: 128, secret: 'never-publish', path: '/private/source' } });
        globalThis[key].error = error;
        send({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: { name: current.name,
          arguments: { repoRoot: '/fixture', repoPath: '/fixture', seed: 'chunk:fixture', chunk: 'missing', ...current.overrides } } });
        const wire = await read();
        assert.equal(wire.id, index + 2); assert.equal(wire.result?.isError, true, mode + ":" + current.code + ":" + JSON.stringify(wire));
        const payload = JSON.parse(wire.result.content[0].text);
        assert.equal(payload.code, current.expected, mode + ':' + current.code);
        if (current.code.startsWith('ERR_SEMANTIC_') || current.code.startsWith('ERR_GRAPH_') || current.code.startsWith('ERR_RUNTIME_'))
          assert.equal(payload.nativeCode, current.code);
        assert.doesNotMatch(JSON.stringify(payload), /never-publish|private\/source/);
        if (current.name.startsWith('semantic_') || current.name === 'graph_evidence' || current.name === 'runtime_evidence') {
          assert.deepEqual(payload.evidence, error.evidence, 'wire retains bounded evidence, including missing/partial state');
          assert.deepEqual(payload.details, { requested: 999, maximum: 128 }, mode + ':' + current.code + ': only allowed structured details survive');
        }
        if (current.name === 'context_pack') assert.deepEqual(payload.evidence, error.evidence);
        if (current.reason) assert.equal(payload.reason, current.reason);
        if (current.noCore) assert.equal(payload.reason, 'invalid_risk_filters');
        if (current.code.endsWith('CURSOR_EXPIRED') || current.code === 'ERR_RUNTIME_QUERY_CURSOR') assert.match(payload.hint, /fresh discovery/);
        values.push(payload);
      }
      wirePayloads.push(values);
    } finally { await service.close(); reader.cancelPending(new Error('fixture reader closed')); input.destroy(); output.destroy(); }
  }
  assert.deepEqual(wirePayloads[0], wirePayloads[1], 'both actual transports retain identical bounded domain meaning');
  assert.equal(globalThis[key].calls, cases.filter(current => !current.noCore).length * 2);
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('Actual handlers and both real MCP transports preserve authoritative bounded domain rejection.');
