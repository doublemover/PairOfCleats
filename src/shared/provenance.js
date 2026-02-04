const buildTimestamp = (now) => (
  typeof now === 'function' ? now() : new Date().toISOString()
);

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
