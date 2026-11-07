import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { resolveRepoPath } from '../../../tools/mcp/repo.js';

const { dir } = await prepareIsolatedTestCacheDir('mcp-selected-generation-sqlite');
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'README.md'), '# Selected prose\nA small SQLite source.\n');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ threads: 1, indexing: { workerPool: { enabled: false }, embeddings: { enabled: false } },
    sqlite: { use: false } }), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const calls = []; globalThis.__selectedSqliteCalls = calls;
const runner = new URL('../../../src/storage/sqlite/build/runner.js', import.meta.url).href;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/src/integrations/core/build-index/sqlite.js') && specifier.endsWith('/build/runner.js')) {
    return { url: 'selected-sqlite:recording', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'selected-sqlite:recording') return { format: 'module', shortCircuit: true, source: `
    import {buildSqliteIndex as actual} from ${JSON.stringify(runner)};
    export const buildSqliteIndex=async options=>{globalThis.__selectedSqliteCalls.push({mode:options.mode,indexRoot:options.indexRoot});return actual(options);};` };
  return next(url, context);
} });
try {
  const { buildIndex } = await import('../../../tools/mcp/tools/handlers/indexing.js');
  assert.equal(resolveRepoPath(repo), toRealPathSync(process.cwd()), 'read-only implicit-root policy remains the enclosing Git root');
  assert.equal(resolveRepoPath(repo, { preserveExplicitTarget: true }), toRealPathSync(repo));
  assert.equal(resolveRepoPath(process.cwd(), { preserveExplicitTarget: true }), toRealPathSync(process.cwd()));
  assert.equal(resolveRepoPath(undefined, { preserveExplicitTarget: true }), resolveRepoPath());
  assert.throws(() => resolveRepoPath(path.join(repo, 'README.md'), { preserveExplicitTarget: true }), /Repo path not found/);
  const result = await buildIndex({ repoPath: repo, mode: 'prose', sqlite: true });
  assert.equal(result.repoPath, toRealPathSync(repo));
  assert.equal(calls.length, 1, 'actual tiny native SQLite build is owned once by core');
  assert.equal(calls[0].mode, 'prose');
  assert.ok(result.outcome.generations.some(generation => generation.buildRoot === calls[0].indexRoot));
  assert.ok(result.outcome.stages.some(stage => stage.validation.status === 'passed' && stage.publication.status === 'published'));
  await fs.writeFile(path.join(dir, 'selected-generation-receipt.json'), JSON.stringify({ calls, result }, null, 2));
} finally { hook.deregister(); delete globalThis.__selectedSqliteCalls; }
console.log(JSON.stringify({ dir, calls }));
