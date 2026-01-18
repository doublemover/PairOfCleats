#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runBuildEmbeddings } from './build-embeddings/run.js';

export { runBuildEmbeddings };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBuildEmbeddings().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
