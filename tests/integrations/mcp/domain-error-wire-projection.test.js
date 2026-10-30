#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { formatToolError } from '../../../src/integrations/mcp/protocol.js';
import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-errors.js';

const key = Symbol.for('poc.test.mcp-domain-error');
globalThis[key] = { evidence: { complete: false, primary: { state: 'missing', missing: true,
  warningCodes: ['PRIMARY_PATH_MISSING'] }, policy: { strictEvidence: true } } };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/analysis.js')) {
      if (resolved.url.endsWith('/src/integrations/tooling/context-pack.js')) return { url: 'poc:domain-builder', shortCircuit: true };
      if (resolved.url.endsWith('/tools/mcp/tools/helpers.js')) return { url: 'poc:domain-repo', shortCircuit: true };
    }
    return resolved;
  },
  load(url, context, next) {
    if (url === 'poc:domain-builder') return { format: 'module', shortCircuit: true,
      source: `export const buildCompositeContextPackPayload=async()=>{throw Object.assign(new Error('Strict evidence incomplete'),{
        code:'ERR_CONTEXT_PACK_STRICT_EVIDENCE',evidence:globalThis[Symbol.for('poc.test.mcp-domain-error')].evidence});};` };
    if (url === 'poc:domain-repo') return { format: 'module', shortCircuit: true,
      source: "export const resolveMcpRepoContext=()=>({repoPath:'/fixture'});" };
    return next(url, context);
  }
});
try {
  const { runContextPack } = await import('../../../tools/mcp/tools/handlers/analysis.js');
  const error = await runContextPack({ repoPath: '/fixture', seed: 'chunk:fixture' })
    .then(() => assert.fail('strict builder must reject'), value => value);
  const projected = formatToolError(error);
  assert.equal(projected.code, 'INVALID_REQUEST');
  assert.equal(projected.reason, 'strict_evidence_incomplete');
  assert.deepEqual(projected.evidence, globalThis[key].evidence);
  for (const wire of [JSON.stringify({ error: { data: projected } }),
    JSON.stringify({ isError: true, content: [{ type: 'text', text: JSON.stringify(projected) }] })]) {
    assert.match(wire, /strict_evidence_incomplete/); assert.match(wire, /PRIMARY_PATH_MISSING/);
  }
} finally { hooks.deregister(); delete globalThis[key]; }
for (const [nativeCode, code, status] of [
  ['ERR_SEMANTIC_QUERY_LIMIT', 'INVALID_REQUEST', 400],
  ['ERR_SEMANTIC_OUTPUT_LIMIT', 'INVALID_REQUEST', 400],
  ['ERR_SEMANTIC_SCOPE_MISMATCH', 'FORBIDDEN', 403],
  ['ERR_SEMANTIC_UNAVAILABLE', 'NO_INDEX', 404],
  ['ERR_SEMANTIC_CURSOR_EXPIRED', 'INVALID_REQUEST', 410],
  ['ERR_SEMANTIC_UNEXPECTED', 'INTERNAL', 500]
]) {
  const error = Object.assign(new Error('domain failure'), { code: nativeCode,
    details: { requested: 999, maximum: 128, secret: 'never-publish', path: 'private-path' } });
  assert.equal(classifySemanticDetailError(error).status, status);
  const payload = JSON.parse(JSON.stringify(formatToolError(error)));
  assert.equal(payload.code, code); assert.equal(payload.nativeCode, nativeCode);
  assert.deepEqual(payload.details, { requested: 999, maximum: 128 });
  assert.doesNotMatch(JSON.stringify(payload), /never-publish|private-path/);
  if (status === 410) assert.match(payload.hint, /fresh discovery/);
}
assert.equal(formatToolError(new Error('unknown')).code, 'INTERNAL');
console.log('MCP handler domain errors preserve bounded structured wire evidence');
