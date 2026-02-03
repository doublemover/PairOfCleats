#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runBuildSqliteIndex } from './sqlite/run.js';

export { runBuildSqliteIndex };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuildSqliteIndex().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
