const PRE_FLIGHT_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  READY: 'ready',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});

const PRE_FLIGHT_STATE_SET = new Set(Object.values(PRE_FLIGHT_STATES));

const PRE_FLIGHT_REASON_CODES = Object.freeze({
  CACHE_HIT: 'preflight_cache_hit',
  COMMAND_UNAVAILABLE: 'preflight_command_unavailable',
  LOCK_UNAVAILABLE: 'preflight_lock_unavailable',
  TIMEOUT: 'preflight_timeout',
  NON_ZERO_EXIT: 'preflight_non_zero_exit',
  SUBPROCESS_FAILURE: 'preflight_subprocess_failure',
  TEARDOWN_FORCED_REAP: 'preflight_teardown_forced_reap',
  FAILED: 'preflight_failed',
  UNKNOWN: 'preflight_unknown'
});

const PRE_FLIGHT_TRANSITIONS = new Map([
  [PRE_FLIGHT_STATES.IDLE, new Set([PRE_FLIGHT_STATES.RUNNING])],
  [PRE_FLIGHT_STATES.RUNNING, new Set([
    PRE_FLIGHT_STATES.READY,
    PRE_FLIGHT_STATES.DEGRADED,
    PRE_FLIGHT_STATES.BLOCKED,
    PRE_FLIGHT_STATES.FAILED,
    PRE_FLIGHT_STATES.SKIPPED
  ])]
]);

const DEFAULT_REASON_BY_STATE = Object.freeze({
  [PRE_FLIGHT_STATES.READY]: null,
  [PRE_FLIGHT_STATES.SKIPPED]: null,
  [PRE_FLIGHT_STATES.BLOCKED]: PRE_FLIGHT_REASON_CODES.LOCK_UNAVAILABLE,
  [PRE_FLIGHT_STATES.DEGRADED]: PRE_FLIGHT_REASON_CODES.SUBPROCESS_FAILURE,
  [PRE_FLIGHT_STATES.FAILED]: PRE_FLIGHT_REASON_CODES.FAILED
});

const coerceState = (value, fallback = PRE_FLIGHT_STATES.READY) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (PRE_FLIGHT_STATE_SET.has(normalized)) return normalized;
  return fallback;
};

const coerceReasonCode = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

export const TOOLING_PREFLIGHT_STATES = PRE_FLIGHT_STATES;
export const TOOLING_PREFLIGHT_REASON_CODES = PRE_FLIGHT_REASON_CODES;

export const isValidToolingPreflightTransition = (fromState, toState) => {
  const from = coerceState(fromState, PRE_FLIGHT_STATES.IDLE);
  const to = coerceState(toState, PRE_FLIGHT_STATES.FAILED);
  const allowed = PRE_FLIGHT_TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
};

export const normalizeToolingPreflightResult = (result) => {
  const payload = (result && typeof result === 'object') ? result : {};
  const normalizedState = (
    payload.blockSourcekit === true
      ? PRE_FLIGHT_STATES.BLOCKED
      : coerceState(payload.state, PRE_FLIGHT_STATES.READY)
  );
  const timedOut = payload.timeout === true || payload.timedOut === true;
  const reasonCode = (
    timedOut
      ? PRE_FLIGHT_REASON_CODES.TIMEOUT
      : coerceReasonCode(payload.reasonCode)
        || DEFAULT_REASON_BY_STATE[normalizedState]
        || PRE_FLIGHT_REASON_CODES.UNKNOWN
  );
  return {
    ...payload,
    state: normalizedState,
    reasonCode,
    timedOut,
    cached: payload.cached === true
  };
};

export const buildToolingPreflightDiagnostic = ({
  providerId,
  preflightId,
  state,
  reasonCode,
  message,
  durationMs,
  timedOut = false,
  cached = false,
  startedAtMs = null,
  finishedAtMs = null
}) => ({
  providerId: String(providerId || ''),
  preflightId: String(preflightId || ''),
  state: coerceState(state, PRE_FLIGHT_STATES.FAILED),
  reasonCode: coerceReasonCode(reasonCode) || PRE_FLIGHT_REASON_CODES.UNKNOWN,
  message: String(message || ''),
  durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : null,
  timedOut: timedOut === true,
  cached: cached === true,
  startedAt: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null,
  finishedAt: Number.isFinite(finishedAtMs) ? new Date(finishedAtMs).toISOString() : null
});
