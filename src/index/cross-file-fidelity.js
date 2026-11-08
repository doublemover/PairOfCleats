/** Semantic admission is independent of CPU, memory, quality and repo size.
 * Scheduling continues to use the existing propagation bundles and scheduler. */
export const CROSS_FILE_FIDELITY_VERSION = 1;

export const resolveCrossFileFidelity = (value) => {
  if (value != null && value !== 'bounded' && value !== 'comprehensive') {
    throw new TypeError('indexing.crossFileFidelity must be bounded or comprehensive.');
  }
  return {
    schemaVersion: CROSS_FILE_FIDELITY_VERSION,
    mode: value ?? 'bounded',
    source: value == null ? 'default' : 'config',
    scope: 'collected-supported-cross-file-candidates',
    ordering: 'canonical-file-round-robin-v1',
    rawSignals: 'preserved'
  };
};

export const crossFileChunkKey = chunk => JSON.stringify([
  chunk?.file || '', chunk?.chunkUid || chunk?.metaV2?.chunkUid || '',
  chunk?.start ?? 0, chunk?.end ?? 0, chunk?.name || '', chunk?.kind || ''
]);

export const orderCrossFileChunks = chunks => {
  const files = new Map();
  for (const chunk of chunks) {
    const file = chunk?.file || '';
    if (!files.has(file)) files.set(file, []);
    files.get(file).push(chunk);
  }
  const groups = [...files.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, group]) => group.sort((left, right) => {
      const a = crossFileChunkKey(left), b = crossFileChunkKey(right);
      return a < b ? -1 : a > b ? 1 : 0;
    }));
  const ordered = [];
  let active = groups.map(group => ({ group, ordinal: 0 }));
  while (active.length) {
    const next = [];
    for (const cursor of active) {
      ordered.push(cursor.group[cursor.ordinal++]);
      if (cursor.ordinal < cursor.group.length) next.push(cursor);
    }
    active = next;
  }
  return ordered;
};

/** These are semantic limits, not a measurement of memory pressure. */
export const resolveCrossFilePropagationBudget = ({ fidelity, chunkCount, fileCount }) => {
  if (fidelity.mode === 'comprehensive') return null;
  if (chunkCount < 3000 && fileCount < 500) return null;
  return {
    maxCallLinksPerChunk: 96, maxCallSummariesPerChunk: 128,
    maxUsageLinksPerChunk: 128, maxTotalCallLinks: 25000, maxTotalUsageLinks: 25000,
    callSampleLimit: 10, paramTypeLimit: 3
  };
};

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const droppedKeys = ['callSignals', 'callDetailSignals', 'chunkUsageSignals', 'fileUsageSignals'];

/** Keep layers separate: these count candidate admissions, never unique missing
 * graph edges. Unsupported/dynamic inputs and unresolved targets remain facts. */
export const buildCrossFileCoverage = ({ fidelity, budgetStats, propagationStats }) => {
  const first = budgetStats || null;
  const second = propagationStats?.admission || null;
  const dropped = first && droppedKeys.every(key => count(first.dropped?.[key]) != null)
    ? droppedKeys.reduce((sum, key) => sum + first.dropped[key], 0) : null;
  const secondDropped = second && ['calls', 'callDetails', 'usages'].every(key => count(second[key]?.dropped) != null)
    ? ['calls', 'callDetails', 'usages'].reduce((sum, key) => sum + second[key].dropped, 0) : null;
  const sampled = count(second?.parameterSamplesDropped);
  const types = count(second?.parameterTypesDropped);
  const admissionStatus = dropped == null || secondDropped == null || sampled == null || types == null ? 'unknown'
    : (dropped + secondDropped + sampled + types > 0 || second.inferenceLiteEnabled ? 'incomplete' : 'complete');
  return {
    schemaVersion: CROSS_FILE_FIDELITY_VERSION, policy: fidelity,
    admission: { status: admissionStatus, firstLayer: first, propagation: second },
    // Successful candidate admission does not qualify upstream extraction,
    // compiler/provider coverage, fixed-point convergence or later graph caps.
    analysis: { status: 'unknown', reasons: ['upstream-and-downstream-coverage-not-qualified'] },
    fingerprint: propagationStats?.fingerprint || null
  };
};

/** Old generations have unknown coverage; absence never proves no impact. */
export const normalizeCrossFileCoverage = receipt => {
  return receipt?.schemaVersion === CROSS_FILE_FIDELITY_VERSION
    ? receipt : { schemaVersion: CROSS_FILE_FIDELITY_VERSION,
      policy: null, fingerprint: null,
      admission: { status: 'unknown', firstLayer: null, propagation: null },
      analysis: { status: 'unknown', reasons: ['coverage-receipt-unavailable'] } };
};

export const resolveCrossFileCoverage = state => normalizeCrossFileCoverage(state?.extensions?.crossFileCoverage);

export const crossFileCoverageWarning = receipt => {
  const coverage = normalizeCrossFileCoverage(receipt);
  if (coverage.admission?.status === 'complete' && coverage.analysis?.status === 'complete') return null;
  return { code: 'UPSTREAM_RELATION_COVERAGE_INCOMPLETE',
    message: 'Relationship analysis has incomplete or unknown coverage; absent edges do not prove no impact, no flow or a clean architecture.',
    data: { admission: coverage.admission?.status || 'unknown', analysis: coverage.analysis?.status || 'unknown',
      policy: coverage.policy?.mode || null } };
};
