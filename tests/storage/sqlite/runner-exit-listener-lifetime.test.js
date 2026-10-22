#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stub = `export const resolveRunnerSelectionPlan=async()=>globalThis.__sqliteListenerPlan;
export const resolveModeSelectionPlan=()=>{throw new Error('unexpected mode');};`;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('/selection-planning.js') && context.parentURL?.includes('/storage/sqlite/build/')) {
    return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
try {
  const { runBuildSqliteIndexWithConfig } = await import('../../../src/storage/sqlite/build/runner.js');
  const before = process.listenerCount('exit');
  for (const failed of [false, true]) {
    for (let index = 0; index < 8; index++) {
      globalThis.__sqliteListenerPlan = failed ? { errorMessage: 'selection failed' }
        : { modeList: [], modeOutputPaths: {}, hasBuildState: false, incrementalRequested: false };
      const operation = runBuildSqliteIndexWithConfig({ argv: {}, emitOutput: false, modeArg: 'code', rawArgs: [] },
        { logger: { log() {}, warn() {}, error() {} }, taskFactory: () => ({ set() {} }) });
      if (failed) await assert.rejects(operation, { code: 'ERR_SQLITE_BUILD_FAILED' });
      else assert.equal((await operation).ok, true);
      assert.equal(process.listenerCount('exit'), before, 'completed invocation must release its exit closure');
    }
  }
} finally { hook.deregister(); delete globalThis.__sqliteListenerPlan; }
console.log('SQLite build runner releases exit listeners on success and failure');
