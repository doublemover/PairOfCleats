#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { emitLegacyCliEntrypointWarning } from './src/shared/legacy-cli-entrypoint.js';
import { runCli } from './src/retrieval/cli/search-entry.js';

const isDirectExecution = () => {
  const executedPath = process.argv[1];
  if (!executedPath) return false;
  return import.meta.url === pathToFileURL(path.resolve(executedPath)).href;
};

if (isDirectExecution()) {
  emitLegacyCliEntrypointWarning({
    entrypoint: 'search.js',
    replacement: 'pairofcleats search',
    args: process.argv.slice(2)
  });
  const exitCode = await runCli();
  process.exitCode = Number.isFinite(Number(exitCode)) ? Number(exitCode) : 0;
}
