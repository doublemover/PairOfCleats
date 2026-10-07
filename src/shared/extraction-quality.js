const isLowYieldObservation = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.triggered === 'boolean';

/** One resolver for observed stage-1 quality; stage-3 synchronization is a separate concern. */
export const resolveExtractionQuality = (payload) => {
  const modes = [payload?.artifacts?.scanProfile?.modes?.['extracted-prose'], payload?.scanProfile?.modes?.['extracted-prose']];
  const canonical = [...modes.map((mode) => mode?.quality),
    payload?.artifacts?.state?.extensions?.extractionQuality, payload?.state?.extensions?.extractionQuality,
    payload?.extractionQuality].find((record) => record && typeof record.observation === 'string');
  if (canonical) {
    const observed = canonical.observation === 'observed' && isLowYieldObservation(canonical.lowYieldBailout)
      && (canonical.stage == null || canonical.stage === 'stage1-extraction');
    return { observation: observed ? 'observed' : 'unknown', source: canonical.source || 'index-state',
      lowYieldBailout: observed ? canonical.lowYieldBailout : null };
  }
  const candidates = [
    ...modes.map((mode) => ['legacy-stage1-timings', mode?.timings?.extractedProseLowYieldBailout]),
    ['legacy-stage1-timings', payload?.timings?.extractedProseLowYieldBailout],
    ['legacy-stage1-state', payload?.artifacts?.state?.extractedProseLowYieldBailout],
    ['legacy-stage1-state', payload?.state?.extractedProseLowYieldBailout],
    ...modes.map((mode) => ['legacy-scan-quality', mode?.quality?.lowYieldBailout]),
    ['legacy-extraction-report', payload?.artifacts?.extractionReport?.quality?.lowYieldBailout],
    ['legacy-extraction-report', payload?.extractionReport?.quality?.lowYieldBailout]
  ];
  for (const [source, candidate] of candidates) {
    if (isLowYieldObservation(candidate)) return { observation: 'observed', source, lowYieldBailout: candidate };
  }
  return { observation: 'unknown', source: null, lowYieldBailout: null };
};

export const resolveTaskLowYieldBailout = (payload) => resolveExtractionQuality(payload).lowYieldBailout;
