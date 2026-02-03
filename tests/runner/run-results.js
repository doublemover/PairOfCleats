const VALID_STATUSES = new Set(['passed', 'failed', 'skipped', 'redo']);

export const normalizeResult = (input = {}) => {
  const status = VALID_STATUSES.has(input.status) ? input.status : 'failed';
  const timedOut = Boolean(input.timedOut);
  const normalized = {
    status: timedOut ? 'failed' : status,
    exitCode: Number.isFinite(input.exitCode) ? input.exitCode : null,
    signal: input.signal || null,
    timedOut,
    durationMs: Number.isFinite(input.durationMs) ? input.durationMs : 0,
    stdout: input.stdout || '',
    stderr: input.stderr || '',
    skipReason: input.skipReason || '',
    termination: input.termination || null,
    attempts: Number.isFinite(input.attempts) ? input.attempts : 1,
    logs: Array.isArray(input.logs) ? input.logs : []
  };
  if (normalized.status === 'skipped' && !normalized.skipReason) {
    normalized.skipReason = 'skipped';
  }
  return normalized;
};

export const summarizeResults = (results, totalMs) => {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: totalMs
  };
  for (const result of results) {
    if (result.status === 'passed') summary.passed += 1;
    else if (result.status === 'failed' || result.status === 'redo') summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
};

export const formatFailure = (result) => {
  if (result.timedOut) return 'timeout';
  if (result.signal) return `signal ${result.signal}`;
  if (Number.isFinite(result.exitCode)) return `exit ${result.exitCode}`;
  return 'failed';
};
