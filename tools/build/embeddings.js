#!/usr/bin/env node
import { isDirectExecution } from '../../src/shared/direct-execution.js';

if (isDirectExecution(import.meta.url)) {
  const { runBuildEmbeddings } = await import('./embeddings/run.js');
  runBuildEmbeddings().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
