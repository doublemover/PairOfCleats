import fs from 'node:fs/promises';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { hrtimeMs, summarizeDurations } from './utils.js';

export async function runIndexBuildBenchmark({
  repoRoot,
  mode,
  threads,
  sqlite,
  stubEmbeddings,
  warmRuns,
  cleanCache
}) {
  const cacheRoot = getRepoCacheRoot(repoRoot);
  if (cleanCache) {
    await fs.rm(cacheRoot, { recursive: true, force: true });
  }

  const coldStart = process.hrtime.bigint();
  await buildIndex(repoRoot, {
    mode,
    threads,
    incremental: false,
    sqlite,
    stubEmbeddings
  });
  const coldMs = hrtimeMs(coldStart);

  const warmTimes = [];
  for (let i = 0; i < warmRuns; i += 1) {
    const start = process.hrtime.bigint();
    await buildIndex(repoRoot, {
      mode,
      threads,
      incremental: true,
      sqlite,
      stubEmbeddings
    });
    warmTimes.push(hrtimeMs(start));
  }

  return {
    repoRoot,
    cacheRoot: path.resolve(cacheRoot),
    coldMs,
    warm: summarizeDurations(warmTimes)
  };
}
