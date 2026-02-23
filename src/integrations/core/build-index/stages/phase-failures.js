export const PHASE_FAILURE_DETAIL_MAX_CHARS = 400;

export const parseNonNegativeInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Build a bounded build-phase failure detail string for state snapshots.
 *
 * Prefers `error.code` + `error.message` when available and truncates overly
 * long payloads to keep heartbeat/build-state artifacts compact.
 *
 * @param {unknown} error
 * @returns {string|null}
 */
export const toPhaseFailureDetail = (error) => {
  if (!error) return null;
  const code = typeof error?.code === 'string' && error.code.trim()
    ? error.code.trim()
    : null;
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim()
    : String(error).trim();
  const combined = code && message && !message.startsWith(`${code}:`)
    ? `${code}: ${message}`
    : (message || code || null);
  if (!combined) return null;
  if (combined.length <= PHASE_FAILURE_DETAIL_MAX_CHARS) return combined;
  return `${combined.slice(0, PHASE_FAILURE_DETAIL_MAX_CHARS - 3)}...`;
};

export const markFailedPhases = async ({
  buildRoot,
  markPhase,
  phaseFailureDetail,
  phases
}) => {
  if (!buildRoot || typeof markPhase !== 'function') return;
  for (const phase of phases || []) {
    if (!phase?.running || phase?.done) continue;
    try {
      await markPhase(buildRoot, phase.name, 'failed', phaseFailureDetail);
    } catch {}
  }
};
