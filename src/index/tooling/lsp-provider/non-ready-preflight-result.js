const readyPreflightResult = () => ({
  state: 'ready',
  reasonCode: null,
  message: '',
  checks: []
});

const normalizePreflightState = (entry) => String(entry?.state || 'ready').trim().toLowerCase();

export const resolveNonReadyPreflightResult = (firstEntries, checkEntries = firstEntries) => {
  let firstNonReady = null;
  for (const entry of firstEntries) {
    if (normalizePreflightState(entry) !== 'ready') {
      firstNonReady = entry;
      break;
    }
  }
  if (!firstNonReady) return readyPreflightResult();
  const checks = checkEntries.flatMap((entry) => (
    Array.isArray(entry?.checks) ? entry.checks : []
  ));
  return {
    state: firstNonReady.state || 'degraded',
    reasonCode: firstNonReady.reasonCode || null,
    message: firstNonReady.message || '',
    ...(checks.length ? { checks } : {})
  };
};
