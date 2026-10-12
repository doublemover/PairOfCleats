#!/usr/bin/env node
import { guardBootstrapEntry } from './src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
const { emitLegacyCliEntrypointWarning } = await import('./src/shared/cli/legacy-entrypoint.js');
const { isDirectExecution } = await import('./src/shared/direct-execution.js');
const { runCli } = await import('./src/retrieval/cli/search-entry.js');

if (isDirectExecution(import.meta.url)) {
  emitLegacyCliEntrypointWarning({
    entrypoint: 'search.js',
    replacement: 'pairofcleats search',
    args: process.argv.slice(2)
  });
  const exitCode = await runCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
}
