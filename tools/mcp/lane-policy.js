const diagnosticTools = new Set(['index_status', 'config_status']);

/** Only explicitly read-only diagnostics enter the SDK control lane. The legacy
 * transport retains its existing opt-in short-timeout classification. */
export const classifyMcpToolLane = (name, timeoutMs, { allowShortTimeoutFast = false } = {}) => {
  if (diagnosticTools.has(String(name || '').trim())) return 'fast';
  if (allowShortTimeoutFast && Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 && Number(timeoutMs) <= 5000) return 'fast';
  return 'slow';
};

/** One total capacity. Reservations govern admission, never early release of a
 * running operation. Capacity one cannot offer an independent diagnostic slot. */
export const resolveMcpLaneAdmission = ({ lane, queueMax, occupancy, reserveSlowCapacity = false }) => {
  if (!Number.isFinite(queueMax) || queueMax <= 0) return { overloaded: false, reason: null };
  if (queueMax > 1 && lane === 'slow' && occupancy.slow >= Math.max(1, queueMax - 1)) return {
    overloaded: true, reason: 'fast-lane-reserved-capacity'
  };
  if (queueMax > 1 && reserveSlowCapacity && lane === 'fast' && occupancy.fast >= Math.max(1, queueMax - 1)) return {
    overloaded: true, reason: 'slow-lane-reserved-capacity'
  };
  if (occupancy.fast + occupancy.slow >= queueMax) return { overloaded: true, reason: 'queue-max-capacity' };
  return { overloaded: false, reason: null };
};
