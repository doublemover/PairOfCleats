#!/usr/bin/env node
import { emitLegacyCliEntrypointWarning } from './src/shared/cli/legacy-entrypoint.js';
import { isDirectExecution } from './src/shared/direct-execution.js';
import { runCli } from './src/retrieval/cli/search-entry.js';

if (isDirectExecution(import.meta.url)) {
  emitLegacyCliEntrypointWarning({
    entrypoint: 'search.js',
    replacement: 'pairofcleats search',
    args: process.argv.slice(2)
  });
  const exitCode = await runCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
}
