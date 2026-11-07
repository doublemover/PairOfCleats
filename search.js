#!/usr/bin/env node
import { guardBootstrapEntry } from './src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const [{ emitLegacyCliEntrypointWarning }, { isDirectExecution }, { runCli }] = await Promise.all([
  import('./src/shared/cli/legacy-entrypoint.js'),
  import('./src/shared/direct-execution.js'),
  import('./src/retrieval/cli/search-entry.js')
]);

if (isDirectExecution(import.meta.url)) {
  emitLegacyCliEntrypointWarning({
    entrypoint: 'search.js',
    replacement: 'pairofcleats search',
    args: process.argv.slice(2)
  });
  const exitCode = await runCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
}
