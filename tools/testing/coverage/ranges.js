import { assertCoverageSourceIdentity, COVERAGE_SOURCE_IDENTITY_VERSION, normalizeCoverageSourcePath } from './source-identity.js';

/** Compact original offset keys retain the same OR/union semantics as one
 * unsharded V8 collection. Adding summary counts cannot reconstruct that union.
 */
export const buildCoverageRanges = byPath => ({ schemaVersion: 1,
  sourceIdentityVersion: COVERAGE_SOURCE_IDENTITY_VERSION, sourcePlatform: process.platform,
  entries: [...byPath].sort(([a], [b]) => a.localeCompare(b)).map(([path, ranges]) => ({ path,
    ranges: [...ranges].sort(([a], [b]) => a.localeCompare(b)) })) });

export const mergeCoverageRanges = documents => {
  const paths = new Map();
  for (const document of documents) {
    assertCoverageSourceIdentity(document);
    if (document.schemaVersion !== 1 || !Array.isArray(document.entries)) throw new Error('Unsupported exact coverage ranges.');
    const seen = new Set();
    for (const entry of document.entries) {
      if (typeof entry.path !== 'string' || !entry.path || normalizeCoverageSourcePath(entry.path, process.cwd()) !== entry.path
        || seen.has(entry.path) || !Array.isArray(entry.ranges)) throw new Error('Invalid exact coverage source.');
      seen.add(entry.path);
      const merged = paths.get(entry.path) || new Map(), keys = new Set();
      for (const row of entry.ranges) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !/^\d+:\d+$/.test(row[0])
          || typeof row[1] !== 'boolean' || keys.has(row[0])) throw new Error('Invalid or duplicate original coverage range.');
        keys.add(row[0]); merged.set(row[0], merged.get(row[0]) === true || row[1]);
      }
      paths.set(entry.path, merged);
    }
  }
  return [...paths].map(([path, ranges]) => ({ path, coveredRanges: [...ranges.values()].filter(Boolean).length,
    totalRanges: ranges.size })).filter(entry => entry.totalRanges > 0).sort((a, b) => a.path.localeCompare(b.path));
};
