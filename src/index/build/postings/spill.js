import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_MAX_OPEN_RUNS,
  mergeRunsWithPlanner,
  mergeSortedRuns,
  readJsonlRows
} from '../../../shared/merge.js';
import { requestCooperativeYield, sortStrings } from './constants.js';

/**
 * Build a stable cache key for merge planner hints from run identity metadata.
 *
 * @param {string} label
 * @param {Array<string|{path?: string}>} runs
 * @param {{ requestYield?: (() => Promise<void> | null) }} [options]
 * @returns {Promise<string|null>}
 */
const buildPlannerInputKey = async (label, runs, { requestYield } = {}) => {
  if (!runs || !runs.length) return null;
  const hash = crypto.createHash('sha1');
  hash.update(label);
  hash.update('\n');
  for (const run of (runs || [])) {
    const runPath = typeof run === 'string' ? run : run?.path;
    if (!runPath) continue;
    const stat = await fs.stat(runPath).catch(() => null);
    hash.update(path.basename(runPath));
    hash.update(':');
    hash.update(String(Number.isFinite(stat?.size) ? stat.size : -1));
    hash.update('\n');
    const pendingYield1 = requestCooperativeYield(requestYield);
    if (pendingYield1) await pendingYield1;
  }
  return hash.digest('hex');
};

/**
 * Row comparator for phrase/chargram spill runs.
 *
 * @param {{ token?: string }} a
 * @param {{ token?: string }} b
 * @returns {number}
 */
export const compareChargramRows = (a, b) => sortStrings(a?.token, b?.token);

/**
 * Create spill/merge helpers shared by phrase and chargram stages.
 *
 * @param {{
 *   buildRoot?: string|null,
 *   plannerCacheDir?: string|null,
 *   requestYield?: (() => Promise<void> | null)|null
 * }} [options]
 * @returns {{
 *   mergeSpillRuns: (input: {
 *     runs: Array<string|{path?: string}>,
 *     compare: (a: any, b: any) => number,
 *     label: string
 *   }) => Promise<{
 *     iterator: AsyncIterable<any>|Iterable<any>|null,
 *     cleanup: (() => Promise<void>)|null,
 *     stats?: object|null,
 *     plannerUsed?: boolean,
 *     plannerHintUsed?: boolean
 *   }>
 * }}
 */
export const createSpillHelpers = ({
  buildRoot = null,
  plannerCacheDir = null,
  requestYield = null
} = {}) => {
  const mergeSpillRuns = async ({ runs, compare, label }) => {
    if (!runs || !runs.length) return { iterator: null, cleanup: null };
    if (!buildRoot || runs.length <= DEFAULT_MAX_OPEN_RUNS) {
      return {
        iterator: mergeSortedRuns(runs, { compare, validateComparator: true }),
        cleanup: null,
        stats: null,
        plannerUsed: false
      };
    }
    const mergeDir = path.join(buildRoot, `${label}.merge`);
    const mergedPath = path.join(mergeDir, `${label}.merged.jsonl`);
    const checkpointPath = path.join(mergeDir, `${label}.checkpoint.json`);
    const plannerHintsPath = plannerCacheDir
      ? path.join(plannerCacheDir, 'spill-merge-planner', `${label}.planner-hints.json`)
      : null;
    const plannerInputKey = await buildPlannerInputKey(label, runs, { requestYield });
    let cleanup = null;
    const cleanupAll = async () => {
      const failures = [];
      if (cleanup) { try { await cleanup(); } catch (error) { failures.push(error); } }
      // The original private directory also owns partially written planner
      // outputs when planning fails before returning its cleanup function.
      for (const [target, recursive] of [[mergedPath, false], [checkpointPath, false], [mergeDir, true]]) {
        try { await fs.rm(target, { recursive, force: true }); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Postings planner output cleanup failed.');
    };
    let stats;
    try {
      const planned = await mergeRunsWithPlanner({
        runs,
        outputPath: mergedPath,
        compare,
        tempDir: mergeDir,
        runPrefix: label,
        checkpointPath,
        maxOpenRuns: DEFAULT_MAX_OPEN_RUNS,
        validateComparator: true,
        plannerHintsPath,
        plannerInputKey
      });
      cleanup = planned.cleanup;
      stats = planned.stats;
    } catch (error) {
      try { await cleanupAll(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Postings planner and original output cleanup failed.', { cause: error });
      }
      throw error;
    }
    return {
      iterator: readJsonlRows(mergedPath),
      cleanup: cleanupAll,
      stats: stats || null,
      plannerUsed: true,
      plannerHintUsed: stats?.plannerHintUsed === true
    };
  };

  return {
    mergeSpillRuns
  };
};
