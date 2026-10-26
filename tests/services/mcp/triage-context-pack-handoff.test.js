#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { TRIAGE_EVIDENCE_VERSION } from '../../../src/contracts/triage-evidence.js';

const key = Symbol.for('poc.test.triage-context-pack-handoff');
const repoPath = path.resolve('.tmp/triage-mcp-repo');
const outPath = path.join(repoPath, 'pack.json');
const reference = { outPath, evidenceVersion: TRIAGE_EVIDENCE_VERSION,
  searchedRepository: { root: repoPath, identityKind: 'search-root-path' }, historyCount: 1, evidenceQueries: 3 };
globalThis[key] = { repoPath, toolRoot: process.cwd(), reference, calls: [], runtimeEnv: { FIXTURE: 'explicit' } };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/triage.js')) {
      if (resolved.url.endsWith('/tools/mcp/runner.js')) return { url: 'poc:triage-runner', shortCircuit: true };
      if (resolved.url.endsWith('/tools/mcp/tools/helpers.js')) return { url: 'poc:triage-repo', shortCircuit: true };
      if (resolved.url.endsWith('/tools/mcp/tools/handlers/indexing.js')) return { url: 'poc:triage-indexing', shortCircuit: true };
    }
    return resolved;
  },
  load(url, context, next) {
    const fixture = "const fixture=globalThis[Symbol.for('poc.test.triage-context-pack-handoff')];";
    if (url === 'poc:triage-runner') return { format: 'module', shortCircuit: true,
      source: `${fixture} export const runNodeSync=()=>{throw new Error('Unexpected sync launch');};
        export const runNodeAsync=async(...args)=>{fixture.calls.push(args);return {stdout:JSON.stringify(fixture.reference)};};` };
    if (url === 'poc:triage-repo') return { format: 'module', shortCircuit: true,
      source: `${fixture} export const toolRoot=fixture.toolRoot;
        export const resolveMcpRepoContext=repoPath=>{if(repoPath!==fixture.repoPath)throw new Error('Wrong repo');
        return {repoPath,runtimeEnv:fixture.runtimeEnv};};` };
    if (url === 'poc:triage-indexing') return { format: 'module', shortCircuit: true,
      source: "export const buildIndex=()=>{throw new Error('Unexpected index build');};" };
    return next(url, context);
  }
});
try {
  const { triageContextPack } = await import('../../../tools/mcp/tools/handlers/triage.js');
  const controller = new AbortController();
  const result = await triageContextPack({ repoPath, recordId: 'finding-one', outPath,
    ann: false, stubEmbeddings: true }, { signal: controller.signal });
  assert.deepEqual(result, reference, 'MCP must preserve the artifact reference and searched repository receipt');
  const [cwd, args, options] = globalThis[key].calls[0];
  assert.equal(cwd, repoPath);
  assert.deepEqual(args, [path.join(process.cwd(), 'tools', 'triage', 'context-pack.js'), '--record', 'finding-one',
    '--repo', repoPath, '--out', outPath, '--no-ann', '--stub-embeddings']);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.env, globalThis[key].runtimeEnv);
  assert.equal(options.streamOutput, true);
  await assert.rejects(() => triageContextPack({ repoPath }), /recordId is required/);
  assert.equal(globalThis[key].calls.length, 1);
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('MCP triage preserves explicit launch arguments, cancellation and the evidence artifact reference.');
