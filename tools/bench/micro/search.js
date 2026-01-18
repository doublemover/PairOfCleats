import { search } from '../../../src/integrations/core/index.js';
import { hrtimeMs, summarizeDurations } from './utils.js';

export async function runSearchBenchmark({
  repoRoot,
  query,
  mode,
  backend,
  ann,
  warmRuns,
  warmupRuns,
  indexCache,
  sqliteCache
}) {
  const executeSearch = async () => {
    const start = process.hrtime.bigint();
    await search(repoRoot, {
      query,
      mode,
      backend,
      ann,
      json: true,
      jsonCompact: true,
      emitOutput: false,
      indexCache,
      sqliteCache
    });
    return hrtimeMs(start);
  };

  if (indexCache?.clear) indexCache.clear();
  if (sqliteCache?.clearAll) sqliteCache.clearAll();

  const coldMs = await executeSearch();

  for (let i = 0; i < warmupRuns; i += 1) {
    await executeSearch();
  }

  const warmTimes = [];
  for (let i = 0; i < warmRuns; i += 1) {
    warmTimes.push(await executeSearch());
  }

  return {
    repoRoot,
    coldMs,
    warm: summarizeDurations(warmTimes)
  };
}
