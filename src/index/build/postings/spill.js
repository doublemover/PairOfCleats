import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { estimateJsonBytes } from '../../../shared/cache.js';
import {
  DEFAULT_MAX_OPEN_RUNS,
  mergeRunsWithPlanner,
  mergeSortedRuns,
  readJsonlRows
} from '../../../shared/merge.js';
import { sortStrings } from './constants.js';

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
    const waitForYield = requestYield?.();
    if (waitForYield) await waitForYield;
  }
  return hash.digest('hex');
};

export const compareChargramRows = (a, b) => sortStrings(a?.token, b?.token);

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
    const { cleanup, stats } = await mergeRunsWithPlanner({
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
    const cleanupAll = async () => {
      if (cleanup) await cleanup();
      await fs.rm(mergedPath, { force: true });
      await fs.rm(checkpointPath, { force: true });
      await fs.rm(mergeDir, { recursive: true, force: true });
    };
    return {
      iterator: readJsonlRows(mergedPath),
      cleanup: cleanupAll,
      stats: stats || null,
      plannerUsed: true,
      plannerHintUsed: stats?.plannerHintUsed === true
    };
  };

  const shouldSpillByBytes = async (map, maxBytes) => {
    if (!maxBytes || !map || typeof map.entries !== 'function') return false;
    let total = 0;
    for (const [token, posting] of map.entries()) {
      total += estimateJsonBytes({ token, postings: posting });
      if (total >= maxBytes) return true;
      const waitForYield = requestYield?.();
      if (waitForYield) await waitForYield;
    }
    return false;
  };

  return {
    mergeSpillRuns,
    shouldSpillByBytes
  };
};
