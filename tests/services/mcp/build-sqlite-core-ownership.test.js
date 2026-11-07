import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getIndexDir } from '../../../src/shared/dict-utils.js';

const { dir } = await prepareIsolatedTestCacheDir('mcp-sqlite-core-ownership');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const state = { repo, calls: [], restored: false, config: { sqlite: { use: true } }, result: null, failure: null };
globalThis.__mcpSqliteOwner = state;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/tools/mcp/tools/handlers/indexing.js')) {
    if (specifier.endsWith('/core/build-index.js')) return { url: 'mcp-owner:core', shortCircuit: true };
    if (specifier === '../helpers.js') return { url: 'mcp-owner:helpers', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'mcp-owner:core') return { format: 'module', shortCircuit: true, source: `
    export const buildIndex=async(root,options)=>{const s=globalThis.__mcpSqliteOwner;s.calls.push({kind:'build',root,options});
      if(s.failure)throw s.failure;return s.result;};
    export const buildSqliteIndex=async(root,options)=>{globalThis.__mcpSqliteOwner.calls.push({kind:'sqlite',root,options});return {ok:true};};` };
  if (url === 'mcp-owner:helpers') return { format: 'module', shortCircuit: true, source: `
    export const maybeRestoreArtifacts=async()=>globalThis.__mcpSqliteOwner.restored;
    export const resolveMcpRepoContext=()=>({repoPath:globalThis.__mcpSqliteOwner.repo,userConfig:globalThis.__mcpSqliteOwner.config,runtimeEnv:process.env});
    export const toolRoot=process.cwd();` };
  return next(url, context);
} });
try {
  const { buildIndex } = await import('../../../tools/mcp/tools/handlers/indexing.js');
  for (const mode of ['code', 'prose', 'extracted-prose', 'records', 'all']) {
    for (const branch of ['ordinary', 'sync-two-stage', 'queued', 'background', 'disabled', 'restore']) {
      state.calls.length = 0; state.restored = branch === 'restore';
      state.result = branch === 'queued' ? { stage2: { queued: true }, outcome: { status: 'pending' } }
        : branch === 'background' ? { stage2: { background: true }, outcome: { status: 'pending' } }
          : { [branch === 'sync-two-stage' ? 'stage2' : 'stage4']: { sqlite: { ok: true } }, outcome: { status: 'stage-completed' } };
      const signal = new AbortController().signal;
      const result = await buildIndex({ repoPath: repo, mode, useArtifacts: true, sqlite: branch !== 'disabled' }, { signal });
      assert.equal(state.calls.length, 1, `${mode}/${branch}: one authoritative storage owner`);
      const call = state.calls[0]; assert.equal(call.root, repo); assert.equal(call.options.mode, mode);
      assert.equal(call.options.abortSignal, signal);
      assert.equal(call.kind, branch === 'restore' ? 'sqlite' : 'build');
      if (branch !== 'restore') assert.deepEqual(result.outcome, state.result.outcome);
      else for (const [selected, key] of [['code', 'codeDir'], ['prose', 'proseDir'], ['extracted-prose', 'extractedProseDir'], ['records', 'recordsDir']]) {
        assert.equal(call.options[key], mode === 'all' || mode === selected ? getIndexDir(repo, selected, state.config) : undefined);
      }
      if (branch === 'disabled') assert.equal(call.options.sqlite, false);
    }
  }
  state.restored = false; state.failure = new Error('authoritative core SQLite failure');
  await assert.rejects(buildIndex({ mode: 'code' }), error => error === state.failure);
} finally { hook.deregister(); delete globalThis.__mcpSqliteOwner; }
console.log('MCP retains one core SQLite owner, selected restored roots and pending two-stage outcomes.');
