export const PHASE_FAILURE_DETAIL_MAX_CHARS = 400;

/**
 * Parse non-negative integer env/config values with fallback.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
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

/**
 * Mark still-running phases as failed after an error.
 *
 * The function is intentionally best-effort: individual mark failures are
 * swallowed to preserve the original build error signal.
 *
 * @param {object} input
 * @param {string} input.buildRoot
 * @param {(buildRoot:string,phase:string,status:string,detail?:string|null)=>Promise<void>} input.markPhase
 * @param {string|null} input.phaseFailureDetail
 * @param {Array<{name:string,running:boolean,done:boolean}>} input.phases
 * @returns {Promise<void>}
 */
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
