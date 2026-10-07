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

const measuredNumber = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/**
 * Classify benchmark tier from measured repo size.
 * Prefers LOC classification when available, then falls back to file count.
 *
 * @param {{loc?:number|null,files?:number|null}} metrics
 * @returns {'small'|'medium'|'large'|'huge'|null}
 */
export const classifyBenchTierBySize = (metrics = {}) => {
  const loc = measuredNumber(metrics?.loc);
  if (loc !== null) {
    for (const tier of BENCH_TIER_ORDER) {
      if (inRange(loc, BENCH_TIER_SIZE_RANGES[tier]?.loc)) return tier;
    }
  }
  const files = measuredNumber(metrics?.files);
  if (files !== null) {
    for (const tier of BENCH_TIER_ORDER) {
      if (inRange(files, BENCH_TIER_SIZE_RANGES[tier]?.files)) return tier;
    }
  }
  return null;
};

/** Compare archived workload observations without assuming an unverified live revision. */
export const validateBenchSizeObservations = ({ config, observations, revisions = {}, now = Date.now(), maxAgeDays = 90 }) => {
  const rows = [];
  const ageMs = now - Date.parse(observations?.measuredAt || '');
  for (const record of observations?.records || []) {
    const key = `${record.language}:${record.repo}`;
    const tier = classifyBenchTierBySize({ loc: record.codeModeLoc, files: record.codeModeFiles });
    const configured = Object.entries(config?.[record.language]?.repos || {})
      .filter(([, repos]) => Array.isArray(repos) && repos.includes(record.repo)).map(([name]) => name);
    const actualRevision = revisions[key];
    const issues = [];
    if (!tier) issues.push('size-unavailable');
    if (tier && !configured.includes(tier)) issues.push('tier-mismatch');
    if (!/^[0-9a-f]{40,64}$/iu.test(String(record.revision || ''))) issues.push('revision-unavailable');
    if (!Number.isFinite(ageMs) || ageMs < 0) issues.push('measurement-date-invalid');
    else if (ageMs > maxAgeDays * 86400000) issues.push('measurement-stale');
    if (actualRevision && actualRevision !== record.revision) issues.push('revision-changed');
    rows.push({ key, tier, configured, issues,
      revisionStatus: actualRevision ? actualRevision === record.revision ? 'matched' : 'changed' : 'unverified' });
  }
  return { ok: rows.every((row) => !row.issues.length), records: rows,
    liveRevisionsVerified: rows.length > 0 && rows.every((row) => row.revisionStatus === 'matched') };
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
