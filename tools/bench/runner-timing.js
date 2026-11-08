const observed = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export const captureArtifactTiming = (artifact, script) => {
  const durationMs = observed(artifact?.durationMs);
  if (durationMs === null) return null;
  const startedAtMs = observed(artifact.startedAtMs ?? artifact.startAtMs);
  const endedAtMs = observed(artifact.endedAtMs ?? artifact.endAtMs);
  const clockOrigin = artifact.clockOrigin === 'unix-epoch-ms' ? 'unix-epoch-ms' : 'unqualified-child-clock';
  return { script, path: typeof artifact.path === 'string' ? artifact.path : null,
    durationMs, stallMs: observed(artifact.stallMs), queueDelayMs: observed(artifact.queueDelayMs), waitMs: observed(artifact.waitMs),
    unit: 'milliseconds', scope: 'producer-declared-artifact', clockOrigin,
    startedAtMs, endedAtMs, crossProcessOrder: clockOrigin === 'unix-epoch-ms' && endedAtMs !== null ? 'available' : 'unavailable' };
};

/** This arithmetic diagnostic has no interval or dependency evidence. It must
 * never be exported as observed wall overlap or a causal critical path. */
export const qualifyAggregateWorkEstimate = row => ({ ...row,
  kind: 'excess-aggregate-stage-work-estimate', observedOverlap: false, causalCriticalPath: false,
  scope: 'reported-stage-durations-minus-declared-total',
  excessWorkMs: row.overlapMs, excessWorkPct: row.overlapPct });
