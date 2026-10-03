export const OBSERVABILITY_METRIC_SELECTORS = Object.freeze({
  capability_downgrade_rate: (metrics) => metrics.capabilityDowngradeRate,
  critical_diagnostic_count: (metrics) => metrics.criticalDiagnosticCount,
  lane_duration_ms: (metrics) => metrics.durationMs,
  lane_peak_memory_mb: (metrics) => metrics.peakMemoryMb,
  redaction_failure_count: (metrics) => metrics.redactionFailureCount,
  unknown_kind_rate: (metrics) => metrics.unknownKindRate,
  unresolved_reference_rate: (metrics) => metrics.unresolvedRate
});

export const compareByOperator = ({ left, operator, right }) => {
  if (operator === '>') return left > right;
  if (operator === '>=') return left >= right;
  if (operator === '<') return left < right;
  if (operator === '<=') return left <= right;
  if (operator === '==') return left === right;
  return false;
};

export const normalizeObservabilityLaneMetrics = (observedLaneMetrics) => {
  if (Array.isArray(observedLaneMetrics)) {
    return new Map(
      observedLaneMetrics
        .filter((row) => row && typeof row === 'object' && typeof row.laneId === 'string')
        .map((row) => [row.laneId, row])
    );
  }

  if (observedLaneMetrics && typeof observedLaneMetrics === 'object') {
    return new Map(
      Object.entries(observedLaneMetrics)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([laneId, value]) => [laneId, { laneId, ...value }])
    );
  }

  return new Map();
};

export const validateObservedNumber = ({ value, field, rowErrors, rowWarnings, blocking }) => {
  if (Number.isFinite(value)) {
    return true;
  }
  const message = `observed metric missing or non-numeric: ${field}`;
  if (blocking) {
    rowErrors.push(message);
  } else {
    rowWarnings.push(message);
  }
  return false;
};

export const buildBatchObservabilityHotspotRows = (sloRows, metricsByLane) => {
  const rows = (Array.isArray(sloRows) ? sloRows : [])
    .filter((row) => row.profileScope === 'batch')
    .map((row) => {
      const observed = metricsByLane.get(row.laneId) || {};
      const durationMs = Number.isFinite(observed.durationMs) ? observed.durationMs : null;
      const peakMemoryMb = Number.isFinite(observed.peakMemoryMb) ? observed.peakMemoryMb : null;
      const parserTimePerSegmentMs = Number.isFinite(observed.parserTimePerSegmentMs) ? observed.parserTimePerSegmentMs : null;
      return {
        rowType: 'batch-hotspot',
        id: `hotspot::${row.laneId}`,
        laneId: row.laneId,
        scopeId: row.scopeId,
        durationMs,
        peakMemoryMb,
        parserTimePerSegmentMs,
        durationRank: null,
        memoryRank: null,
        parserTimeRank: null,
        isDurationHotspot: false,
        isMemoryHotspot: false,
        isParserTimeHotspot: false,
        blocking: false,
        pass: true,
        errors: Object.freeze([]),
        warnings: Object.freeze([])
      };
    })
    .sort((a, b) => a.laneId.localeCompare(b.laneId));

  const assignRank = (key, rankKey, hotspotFlag) => {
    const ranked = [...rows]
      .filter((row) => Number.isFinite(row[key]))
      .sort((a, b) => {
        if (b[key] !== a[key]) return b[key] - a[key];
        return a.laneId.localeCompare(b.laneId);
      });
    ranked.forEach((row, index) => {
      row[rankKey] = index + 1;
      row[hotspotFlag] = index < 3;
    });
  };

  assignRank('durationMs', 'durationRank', 'isDurationHotspot');
  assignRank('peakMemoryMb', 'memoryRank', 'isMemoryHotspot');
  assignRank('parserTimePerSegmentMs', 'parserTimeRank', 'isParserTimeHotspot');

  return rows;
};
