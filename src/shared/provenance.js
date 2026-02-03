/**
 * Resolve a timestamp for provenance payloads.
 * @param {(() => string)|undefined} now
 * @returns {string}
 */
const buildTimestamp = (now) => (
  typeof now === 'function' ? now() : new Date().toISOString()
);

/**
 * Normalize provenance metadata for artifacts and stats.
 *
 * Deterministic: only fields provided or derived from inputs are included.
 * Error behavior: throws when neither indexSignature nor indexCompatKey is provided.
 *
 * @param {object} [options]
 * @param {object} [options.provenance]
 * @param {string} [options.indexSignature]
 * @param {string} [options.indexCompatKey]
 * @param {object} [options.capsUsed]
 * @param {string} [options.repo]
 * @param {string} [options.indexDir]
 * @param {() => string} [options.now]
 * @param {string} [options.label]
 * @returns {object}
 */
export const resolveProvenance = ({
  provenance,
  indexSignature,
  indexCompatKey,
  capsUsed,
  repo,
  indexDir,
  now,
  label = 'Provenance'
} = {}) => {
  const timestamp = buildTimestamp(now);
  if (provenance && typeof provenance === 'object') {
    const merged = { ...provenance };
    if (!merged.generatedAt) merged.generatedAt = timestamp;
    if (!merged.capsUsed) merged.capsUsed = capsUsed || {};
    if (!merged.indexSignature && !merged.indexCompatKey) {
      throw new Error('Provenance must include indexSignature or indexCompatKey.');
    }
    return merged;
  }
  if (!indexSignature && !indexCompatKey) {
    throw new Error(`${label} requires indexSignature or indexCompatKey.`);
  }
  const base = {
    generatedAt: timestamp,
    capsUsed: capsUsed || {}
  };
  if (indexSignature) base.indexSignature = indexSignature;
  if (indexCompatKey) base.indexCompatKey = indexCompatKey;
  if (repo) base.repo = repo;
  if (indexDir) base.indexDir = indexDir;
  return base;
};
