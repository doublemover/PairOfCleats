#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { runBuildEmbeddings } = await import('./embeddings/run.js');
  runBuildEmbeddings().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
