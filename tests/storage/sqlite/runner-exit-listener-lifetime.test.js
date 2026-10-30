#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withSqliteStorageOperation } from '../../../src/storage/sqlite/build/storage-operation.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-runner-exit-lifetime');
const root = path.join(dir, 'repo'), cache = path.join(dir, 'cache'); await fs.mkdir(root);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } };

const stub = `export const resolveRunnerSelectionPlan=async input=>{
  try{return await input.onSelected(globalThis.__sqliteListenerPlan);}
  finally{await input.onFinalized();}
};
export const resolveModeSelectionPlan=()=>{throw new Error('unexpected mode');};`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('/selection-planning.js') && context.parentURL?.includes('/storage/sqlite/build/')) {
    return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
try {
  const { runBuildSqliteIndexWithConfig } = await import('../../../src/storage/sqlite/build/runner.js');
  // Initialize the existing process-wide lease hook once; the repeated runner
  // invocations below must still release every invocation-specific exit closure.
  const initial = process.listenerCount('exit');
  await withSqliteStorageOperation({ repoRoot: root, userConfig }, [], () => {});
  const before = process.listenerCount('exit');
  assert.ok(before >= initial && before - initial <= 1, 'at most one shared lease-protocol exit hook');
  for (const failed of [false, true]) {
    for (let index = 0; index < 8; index++) {
      globalThis.__sqliteListenerPlan = failed ? { errorMessage: 'selection failed' }
        : { root, userConfig, modeList: [], modeOutputPaths: {}, hasBuildState: false, incrementalRequested: false };
      const operation = runBuildSqliteIndexWithConfig({ argv: {}, emitOutput: false, modeArg: 'code', rawArgs: [] },
        { logger: { log() {}, warn() {}, error() {} }, taskFactory: () => ({ set() {} }) });
      if (failed) await assert.rejects(operation, { code: 'ERR_SQLITE_BUILD_FAILED' });
      else assert.equal((await operation).ok, true);
      assert.equal(process.listenerCount('exit'), before, 'completed invocation must release its exit closure');
    }
  }
} finally { hook.deregister(); delete globalThis.__sqliteListenerPlan; }
console.log('SQLite build runner releases exit listeners on success and failure');
