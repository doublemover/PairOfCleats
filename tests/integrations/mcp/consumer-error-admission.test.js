import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { normalizeMcpToolResponse } from '../../../src/integrations/mcp/result-envelope.js';
const legacy = normalizeMcpToolResponse({ jsonrpc: '2.0', error: { code: -32001, message: 'busy', data: { code: 'QUEUE_OVERLOADED' } } });
const sdk = normalizeMcpToolResponse({ isError: true, content: [{ type: 'text', text: '{"code":"QUEUE_OVERLOADED","message":"busy"}' }] });
assert.equal(legacy.ok, false); assert.equal(sdk.ok, false);
assert.equal(legacy.retryable, true); assert.equal(sdk.retryable, true);
assert.equal(normalizeMcpToolResponse({ isError: false, content: [{ type: 'text', text: '{"code":"QUEUE_OVERLOADED"}' }] }).ok, true);
assert.equal(normalizeMcpToolResponse({ isError: true, content: [{ type: 'text', text: 'unparseable error' }] }).retryable, false);
const key = Symbol.for('poc.mcp.cache-gc-admission');
globalThis[key] = { contexts: 0, runs: 0, payload: { ok: true, dryRun: true } };
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/artifacts.js') && result.url.endsWith('/tools/mcp/runner.js'))
      return { url: 'poc:gc-runner', shortCircuit: true };
    if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/artifacts.js') && result.url.endsWith('/tools/mcp/tools/helpers.js'))
      return { url: 'poc:gc-context', shortCircuit: true };
    return result;
  },
  load(url, context, nextLoad) {
    if (url === 'poc:gc-runner') return { format: 'module', shortCircuit: true,
      source: `const state=globalThis[Symbol.for('poc.mcp.cache-gc-admission')]; export const runNodeAsync=async()=>{state.runs++;return {stdout:JSON.stringify(state.payload)}}; export const runToolWithProgress=async()=>'';` };
    if (url === 'poc:gc-context') return { format: 'module', shortCircuit: true,
      source: `const state=globalThis[Symbol.for('poc.mcp.cache-gc-admission')]; export const toolRoot='fixture'; export const resolveMcpRepoContext=()=>{state.contexts++;return {repoPath:'fixture',runtimeEnv:{}}};` };
    return nextLoad(url, context);
  }
});
try {
  const { cacheGc } = await import('../../../tools/mcp/tools/handlers/artifacts.js');
  for (const args of [{}, { maxBytes: null }, { maxBytes: 0 }, { maxGb: NaN }, { maxAgeDays: -1 }, { maxBytes: '100' }])
    await assert.rejects(cacheGc(args), { code: 'INVALID_REQUEST' });
  assert.equal(globalThis[key].contexts, 0); assert.equal(globalThis[key].runs, 0);
  assert.equal((await cacheGc({ maxBytes: 100 })).ok, true);
  globalThis[key].payload = { ok: false, message: 'Repo cache root not found' };
  await assert.rejects(cacheGc({ maxBytes: 100 }), { code: 'INTERNAL' });
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('MCP consumers distinguish overload envelopes and reject cache-GC non-actions before setup.');
