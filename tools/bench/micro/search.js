import { search } from '../../../src/integrations/core/index.js';
import { hrtimeMs, summarizeDurations } from './utils.js';

export async function runSearchBenchmark({
  repoRoot,
  query,
  mode,
  backend,
  ann,
  scoreMode,
  warmRuns,
  warmupRuns,
  indexCache,
  sqliteCache
}) {
  const validateScoreMode = async () => {
    if (!scoreMode) return;
    const payload = await search(repoRoot, {
      query,
      mode,
      backend,
      ann,
      scoreMode,
      explain: true,
      json: true,
      jsonCompact: true,
      emitOutput: false,
      indexCache,
      sqliteCache
    });
    const hits = mode === 'prose' ? payload.prose || [] : payload.code || [];
    const first = hits[0];
    if (!first) {
      throw new Error(`bench search sanity failed: no hits for scoreMode=${scoreMode}`);
    }
    if (scoreMode === 'sparse') {
      if (first.scoreType === 'blend' || first.scoreType === 'ann') {
        throw new Error(`bench search sanity failed: expected sparse scoring, saw ${first.scoreType}`);
      }
      return;
    }
    if (first.scoreType !== 'blend') {
      throw new Error(`bench search sanity failed: expected blend scoring, saw ${first.scoreType}`);
    }
    const blend = first.scoreBreakdown?.blend;
    if (!blend) {
      throw new Error('bench search sanity failed: missing blend breakdown');
    }
    if (scoreMode === 'dense') {
      if (blend.sparseWeight !== 0 || blend.annWeight <= 0) {
        throw new Error('bench search sanity failed: dense weights not applied');
      }
    } else if (scoreMode === 'hybrid') {
      if (blend.sparseWeight === 0 || blend.annWeight === 0) {
        throw new Error('bench search sanity failed: hybrid weights not applied');
      }
    }
  };

  const executeSearch = async () => {
    const start = process.hrtime.bigint();
    await search(repoRoot, {
      query,
      mode,
      backend,
      ann,
      scoreMode,
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

  await validateScoreMode();

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
    scoreMode: scoreMode || null,
    coldMs,
    warm: summarizeDurations(warmTimes)
  };
}
