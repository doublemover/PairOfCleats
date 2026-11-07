import { INTERNAL_QUERY_CACHE_BYPASS } from '../../../src/retrieval/query-cache-experiment.js';
import { captureMicroQuerySchedule, createSearchMicroCollector } from './search-observation.js';
import { search } from '../../../src/integrations/core/search.js';
import { hrtimeMs, summarizeDurations } from './utils.js';

export async function runSearchBenchmark({
  repoRoot,
  query,
  mode,
  backend,
  ann,
  annBackend,
  scoreMode,
  warmRuns,
  warmupRuns,
  indexCache,
  sqliteCache,
  workMode = 'retrieval',
  querySchedule = null
}) {
  if (![warmRuns, warmupRuns].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 10000)) {
    throw new TypeError('Search microbenchmark run counts must be safe integers between zero and 10000.');
  }
  if (!['retrieval', 'result-cache'].includes(workMode)) throw new TypeError('Unknown search microbenchmark work mode.');
  const schedule = captureMicroQuerySchedule(query, querySchedule);
  const collector = createSearchMicroCollector({ mode, scoreMode, workMode, requestedBackend: backend, annBackend });
  const cursors = new Map();
  const searchArgs = ['--stats'];
  const validateScoreMode = async () => {
    if (!scoreMode) return;
    const payload = await search(repoRoot, {
      query: schedule.queries[0],
      args: searchArgs,
      [INTERNAL_QUERY_CACHE_BYPASS]: workMode === 'retrieval',
      mode,
      backend,
      ann,
      annBackend,
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

  const executeSearch = async phase => {
    const cursor = cursors.get(phase) || 0;
    cursors.set(phase, cursor + 1);
    const queryIndex = cursor % schedule.count;
    const start = process.hrtime.bigint();
    const payload = await search(repoRoot, {
      query: schedule.queries[queryIndex], mode, backend, ann, annBackend, scoreMode,
      args: searchArgs, [INTERNAL_QUERY_CACHE_BYPASS]: workMode === 'retrieval',
      json: true, jsonCompact: true, emitOutput: false, indexCache, sqliteCache
    });
    const durationMs = hrtimeMs(start);
    collector.observe(payload, { phase, queryIndex, durationMs });
    return durationMs;
  };

  if (indexCache?.clear) indexCache.clear();
  if (sqliteCache?.closeAll) sqliteCache.closeAll();

  await validateScoreMode();

  if (indexCache?.clear) indexCache.clear();
  if (sqliteCache?.closeAll) sqliteCache.closeAll();

  const coldMs = await executeSearch('initial');

  for (let i = 0; i < warmupRuns; i += 1) {
    await executeSearch('warmup');
  }

  const warmTimes = [];
  for (let i = 0; i < warmRuns; i += 1) {
    warmTimes.push(await executeSearch('measured'));
  }

  return {
    repoRoot,
    mode,
    backend,
    annBackend: annBackend || null,
    scoreMode: scoreMode || null,
    workMode,
    querySchedule: schedule,
    coldness: { process: 'not-reset', indexHandles: 'cleared-before-initial', model: 'not-reset',
      resultCache: workMode === 'retrieval' ? 'bypassed-without-quality-change' : 'observed-existing-cache-state', filesystem: 'uncontrolled' },
    initialMs: coldMs,
    work: collector.snapshot(),
    coldMs,
    warm: summarizeDurations(warmTimes)
  };
}
