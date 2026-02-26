export const BENCH_TIER_ORDER = Object.freeze([
  'small',
  'medium',
  'large',
  'huge'
]);

const POSITIVE_INFINITY = Number.POSITIVE_INFINITY;

/**
 * Canonical non-overlapping size bands for benchmark tiers.
 * All bounds are [minInclusive, maxExclusive).
 */
export const BENCH_TIER_SIZE_RANGES = Object.freeze({
  small: Object.freeze({
    loc: Object.freeze([0, 25_000]),
    files: Object.freeze([0, 400])
  }),
  medium: Object.freeze({
    loc: Object.freeze([25_000, 300_000]),
    files: Object.freeze([400, 3_500])
  }),
  large: Object.freeze({
    loc: Object.freeze([300_000, 3_000_000]),
    files: Object.freeze([3_500, 30_000])
  }),
  huge: Object.freeze({
    loc: Object.freeze([3_000_000, POSITIVE_INFINITY]),
    files: Object.freeze([30_000, POSITIVE_INFINITY])
  })
});

const inRange = (value, range) => {
  if (!Array.isArray(range) || range.length !== 2) return false;
  const [min, max] = range;
  if (!Number.isFinite(Number(value))) return false;
  const numeric = Number(value);
  return numeric >= min && numeric < max;
};

/**
 * Classify benchmark tier from measured repo size.
 * Prefers LOC classification when available, then falls back to file count.
 *
 * @param {{loc?:number|null,files?:number|null}} metrics
 * @returns {'small'|'medium'|'large'|'huge'|null}
 */
export const classifyBenchTierBySize = (metrics = {}) => {
  const loc = Number(metrics?.loc);
  if (Number.isFinite(loc) && loc >= 0) {
    for (const tier of BENCH_TIER_ORDER) {
      if (inRange(loc, BENCH_TIER_SIZE_RANGES[tier]?.loc)) return tier;
    }
  }
  const files = Number(metrics?.files);
  if (Number.isFinite(files) && files >= 0) {
    for (const tier of BENCH_TIER_ORDER) {
      if (inRange(files, BENCH_TIER_SIZE_RANGES[tier]?.files)) return tier;
    }
  }
  return null;
};

const SUPPORTED_TIERS = new Set(BENCH_TIER_ORDER);

/**
 * Validate bench repo tier config for duplicate assignment and unknown tier keys.
 *
 * @param {object} config
 * @returns {{
 *   ok:boolean,
 *   issues:Array<{
 *     language:string,
 *     repo?:string,
 *     tier?:string,
 *     code:'unknown-tier'|'duplicate-tier-repo',
 *     level:'error'|'warn',
 *     message:string
 *   }>
 * }}
 */
export const validateBenchTierConfig = (config = {}) => {
  const issues = [];
  let fatalIssueCount = 0;
  if (!config || typeof config !== 'object') {
    return {
      ok: false,
      issues: [{
        language: '(root)',
        code: 'unknown-tier',
        level: 'error',
        message: 'Bench config must be an object.'
      }]
    };
  }
  for (const [languageId, languageEntry] of Object.entries(config)) {
    const repos = languageEntry?.repos;
    if (!repos || typeof repos !== 'object') continue;
    const seenTierByRepo = new Map();
    for (const [tier, list] of Object.entries(repos)) {
      if (!SUPPORTED_TIERS.has(tier)) {
        issues.push({
          language: languageId,
          tier,
          code: 'unknown-tier',
          level: 'error',
          message: `Unknown tier key "${tier}".`
        });
        fatalIssueCount += 1;
      }
      if (!Array.isArray(list)) continue;
      for (const repo of list) {
        if (typeof repo !== 'string' || !repo.trim()) continue;
        const normalized = repo.trim();
        if (seenTierByRepo.has(normalized)) {
          issues.push({
            language: languageId,
            repo: normalized,
            tier,
            code: 'duplicate-tier-repo',
            level: 'warn',
            message: `Repo "${normalized}" appears in multiple tiers (${seenTierByRepo.get(normalized)} and ${tier}).`
          });
        } else {
          seenTierByRepo.set(normalized, tier);
        }
      }
    }
  }
  return {
    ok: fatalIssueCount === 0,
    issues
  };
};
