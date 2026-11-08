import { createHash } from 'node:crypto';
import { stableStringify } from '../../src/shared/stable-json.js';
import { sweepFusionReplays } from '../../src/retrieval/evaluation/fusion-sweep.js';

/** Optional dataset data extends the existing report, never its live judged
 * aggregates. All cases must name the same explicit development grid/seed. */
export const evaluateDatasetFusionReplay = async ({ cases, signal = null, limits = {}, resumeKey = null }) => {
  const records = [];
  let grid = null, seed = null;
  for (const entry of cases) {
    if (entry?.fusionReplay == null) continue;
    const selected = Array.isArray(entry.fusionReplay) ? entry.fusionReplay : [entry.fusionReplay];
    if (!selected.length || selected.length > 4) throw new Error('A dataset case permits one to four saved fusion records.');
    const query = String(entry.query || '').trim(), textDigest = createHash('sha256').update(query).digest('hex');
    const candidateGrid = entry.fusionReplayGrid, candidateSeed = entry.fusionReplaySeed ?? 'fusion-sweep-v1';
    if (!Array.isArray(candidateGrid) || !candidateGrid.length || candidateGrid.length > 64) throw new Error('Saved fusion replay requires an explicit bounded fusionReplayGrid.');
    if (grid && (stableStringify(grid) !== stableStringify(candidateGrid) || seed !== candidateSeed)) throw new Error('Dataset fusion grids/split seeds disagree.');
    grid = candidateGrid; seed = candidateSeed;
    for (const record of selected) {
      if (record?.provenance?.textDigest !== textDigest) throw new Error('Saved fusion query identity does not match this dataset case.');
      records.push(record);
      if (records.length > 256) throw new Error('Dataset fusion replay exceeds256 records.');
    }
  }
  if (!records.length) return null;
  return { kind: 'saved-fusion-sweep', currentSearchEvidence: false, aggregation: 'separate-from-live-judged-metrics',
    receipt: await sweepFusionReplays({ records, grid, seed, signal, limits, resumeKey }) };
};
