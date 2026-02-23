import { compareText } from './display-meta.js';

export const RESULT_BUNDLE_SCHEMA_VERSION = 1;

const BUNDLE_MODE_ORDER = Object.freeze(['code', 'extractedProse', 'prose', 'records']);
const BUNDLE_MODE_RANK = new Map(BUNDLE_MODE_ORDER.map((mode, index) => [mode, index]));

/**
 * Assemble deterministic result bundles grouped by file path.
 * @param {object} input
 * @returns {{schemaVersion:number,groups:Array<object>}}
 */
export const buildResultBundles = ({
  code = [],
  extractedProse = [],
  prose = [],
  records = []
} = {}) => {
  const byMode = [
    { mode: 'code', hits: Array.isArray(code) ? code : [] },
    { mode: 'extractedProse', hits: Array.isArray(extractedProse) ? extractedProse : [] },
    { mode: 'prose', hits: Array.isArray(prose) ? prose : [] },
    { mode: 'records', hits: Array.isArray(records) ? records : [] }
  ];
  const bundles = new Map();
  for (const { mode, hits } of byMode) {
    const modeRank = BUNDLE_MODE_RANK.get(mode) ?? Number.MAX_SAFE_INTEGER;
    for (let index = 0; index < hits.length; index += 1) {
      const hit = hits[index];
      const file = typeof hit?.file === 'string' && hit.file.trim() ? hit.file : null;
      const key = file || `__no_file__:${mode}:${index}`;
      let bundle = bundles.get(key);
      if (!bundle) {
        bundle = {
          key,
          file,
          totalScore: 0,
          topScore: Number.NEGATIVE_INFINITY,
          hitCount: 0,
          modes: new Set(),
          firstSeenModeRank: modeRank,
          firstSeenIndex: index,
          hits: []
        };
        bundles.set(key, bundle);
      }
      const score = Number.isFinite(Number(hit?.score)) ? Number(hit.score) : 0;
      bundle.totalScore += score;
      bundle.topScore = Math.max(bundle.topScore, score);
      bundle.hitCount += 1;
      bundle.modes.add(mode);
      if (modeRank < bundle.firstSeenModeRank || (
        modeRank === bundle.firstSeenModeRank
        && index < bundle.firstSeenIndex
      )) {
        bundle.firstSeenModeRank = modeRank;
        bundle.firstSeenIndex = index;
      }
      bundle.hits.push({
        mode,
        modeRank,
        index,
        score,
        scoreType: hit?.scoreType || null,
        id: hit?.id ?? null,
        file: file || null,
        start: Number.isFinite(Number(hit?.start)) ? Number(hit.start) : null,
        end: Number.isFinite(Number(hit?.end)) ? Number(hit.end) : null
      });
    }
  }
  const groups = Array.from(bundles.values())
    .map((bundle) => {
      bundle.hits.sort((a, b) => (
        (b.score - a.score)
        || ((a.modeRank ?? Number.MAX_SAFE_INTEGER) - (b.modeRank ?? Number.MAX_SAFE_INTEGER))
        || (a.index - b.index)
        || compareText(a.id, b.id)
      ));
      return {
        bundleId: bundle.file || bundle.key,
        file: bundle.file,
        hitCount: bundle.hitCount,
        totalScore: bundle.totalScore,
        topScore: Number.isFinite(bundle.topScore) ? bundle.topScore : 0,
        modeCount: bundle.modes.size,
        modes: Array.from(bundle.modes).sort((a, b) => (
          (BUNDLE_MODE_RANK.get(a) ?? Number.MAX_SAFE_INTEGER) - (BUNDLE_MODE_RANK.get(b) ?? Number.MAX_SAFE_INTEGER)
        )),
        hits: bundle.hits.map(({ mode, index, score, scoreType, id, file, start, end }) => ({
          mode,
          index,
          score,
          scoreType,
          id,
          file,
          start,
          end
        }))
      };
    });
  groups.sort((a, b) => (
    (b.totalScore - a.totalScore)
    || (b.topScore - a.topScore)
    || (b.modeCount - a.modeCount)
    || compareText(a.file || '', b.file || '')
    || compareText(a.bundleId, b.bundleId)
  ));
  return {
    schemaVersion: RESULT_BUNDLE_SCHEMA_VERSION,
    groups
  };
};
