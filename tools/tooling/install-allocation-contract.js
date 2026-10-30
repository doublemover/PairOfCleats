import path from 'node:path';

/** Canonical recipes declare the peak additional allocation, including expanded
 * artifacts, package/build caches and staging. Archive length alone is not that
 * estimate; unknown transitive package writes stay unknown rather than zero.
 */
export const resolveDeclaredInstallAdmission = recipe => {
  const estimate = recipe?.storageEstimate;
  const budget = (write, key, fallback) => {
    const value = write?.[key];
    if (value === undefined || value === null) return fallback;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Declared install storage budget must be a nonnegative safe integer.');
    return value;
  };
  const forecast = estimate?.basis === 'canonical-build-forecast-v1';
  if ((estimate?.complete !== true && !forecast) || !Array.isArray(estimate?.writes) || !estimate.writes.length || estimate.writes.length > 64) {
    return { writes: null, state: 'deferred-unknown-allocation', source: 'unknown-artifact-build-allocation',
      nextAction: 'The selected product recipe needs qualified storage bounds; use an already verified compatible tool or update this recipe.' };
  }
  const writes = estimate.writes.map(write => {
    const selectors = [write.root, write.destination, write.environmentKey].filter(value => value !== undefined);
    if (selectors.length !== 1 || selectors.some(value => typeof value !== 'string' || !value)
      || (write.root && !path.isAbsolute(write.root))
      || (write.destination && !['artifacts', 'scratch'].includes(write.destination))) throw new TypeError('Declared install allocation needs one exact root, artifact/scratch destination or environment-key owner.');
    const requiredBytes = budget(write, 'requiredBytes', null);
    if (requiredBytes === null) throw new TypeError('Declared install destination requires an exact byte estimate.');
    return { ...(write.root ? { root: path.resolve(write.root) } : write.destination ? { destination: write.destination } : { environmentKey: write.environmentKey }),
      requiredBytes, minimumFreeBytes: budget(write, 'minimumFreeBytes', 0), hardBytes: budget(write, 'hardBytes', null) };
  });
  if (estimate.basis !== undefined && !['canonical-build-forecast-v1', 'bounded-archive-owner-v1'].includes(estimate.basis)) {
    throw new TypeError('Unknown canonical install allocation basis.');
  }
  return { writes: forecast ? null : writes, ...(forecast ? { forecastWrites: writes,
    nextAction: 'The pinned recipe needs a qualified build allowance before installation; rerunning command discovery cannot provide one.' } : {}),
  source: forecast ? 'canonical-recipe-build-forecast' : 'canonical-recipe-declared-destination-peaks',
  state: forecast ? 'deferred-unqualified-build-allocation' : 'estimate-declared',
  ...(estimate.basis ? { basis: estimate.basis, measured: false } : {}),
  ...(typeof estimate.recipe === 'string' ? { recipe: estimate.recipe } : {}) };
};
