import { SEARCH_MICRO_REPORT_VERSION, captureMicroQuerySchedule } from './search-observation.js';
import { isRetrievalExecution } from '../../../src/contracts/retrieval-execution.js';
import { isRetrievalModelObservation } from '../../../src/contracts/retrieval-work.js';

const metricKeys = ['meanMs', 'p50Ms', 'p95Ms', 'p99Ms'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const knownString = value => typeof value === 'string' && value.trim().length > 0 && !['unknown', 'n/a'].includes(value);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const knownSource = value => value && ['buildId', 'generationKey', 'activeBuildRoot', 'signature', 'artifactSurfaceVersion', 'profileId']
  .every(field => knownString(value[field]));
const knownModel = (value, scoreMode, workMode) => scoreMode === 'sparse'
  ? value?.status === 'not-applicable' && value.reason === 'sparse-score-workload'
  : workMode === 'result-cache' ? value?.status === 'not-applicable' && value.reason === 'result-cache-replay'
    : isRetrievalModelObservation(value);

/** Code revision is provenance, not a controlled workload axis: changing code
 * is an intended experiment. Baselines lacking controls stay historical data. */
export const compareSearchMicroBaseline = (current, baseline, { variedAxis = null } = {}) => {
  const differences = [], components = {}, deltas = {};
  const reject = (axis, reason, component = null) => {
    if (!differences.some(row => row.axis === axis && row.reason === reason && row.component === component)) differences.push({ axis, reason, component });
  };
  if (![null, 'backend', 'ann-backend'].includes(variedAxis)) reject('experiment', 'unsupported-varied-axis');
  for (const [side, value] of [['current', current], ['baseline', baseline]]) {
    if (value?.schemaVersion !== SEARCH_MICRO_REPORT_VERSION || value?.kind !== 'search-microbenchmark'
      || !value.components || typeof value.components !== 'object' || Array.isArray(value.components)) reject(side, 'legacy-or-unsupported-report');
    if (!knownString(value?.querySchedule?.identity) || !Array.isArray(value?.querySchedule?.queries)
      || !value.querySchedule.queries.length || value.querySchedule.count !== value.querySchedule.queries.length) reject(side, 'query-workload-unknown');
    else {
      let captured;
      try { captured = captureMicroQuerySchedule(null, value.querySchedule.queries); } catch { captured = null; }
      if (!captured || !same(captured, value.querySchedule)) reject(side, 'query-schedule-identity-invalid');
    }
    if (!['retrieval', 'result-cache'].includes(value?.workMode) || !['code', 'prose'].includes(value?.mode)
      || !knownString(value?.repoRoot) || !knownString(value?.backend)) reject(side, 'work-mode-or-repository-unknown');
  }
  for (const axis of ['repoRoot', 'mode', 'workMode', 'querySchedule']) {
    if (current?.[axis] == null || baseline?.[axis] == null || !same(current[axis], baseline[axis])) reject(axis, 'controlled-workload-mismatch');
  }
  for (const axis of ['node', 'abi', 'platform', 'arch', 'cpuModel', 'cpuCount']) {
    if (current?.env?.[axis] == null || baseline?.env?.[axis] == null
      || current.env[axis] === 'unknown' || baseline.env[axis] === 'unknown'
      || !same(current.env[axis], baseline.env[axis])) reject(`runtime.${axis}`, 'runtime-or-host-mismatch-or-unknown');
    if (axis === 'cpuCount' ? !Number.isSafeInteger(current?.env?.[axis]) || current.env[axis] <= 0
      : !knownString(current?.env?.[axis]) || !knownString(baseline?.env?.[axis])) reject(`runtime.${axis}`, 'runtime-or-host-type-unknown');
  }
  if (variedAxis !== 'backend' && current?.backend !== baseline?.backend) reject('backend', 'undeclared-backend-change');
  const names = [...new Set([...Object.keys(current?.components || {}), ...Object.keys(baseline?.components || {})])];
  if (!names.length) reject('components', 'no-components');
  if (names.length > 4 || names.some(name => !['search-sparse', 'search-ann', 'search-dense', 'search-hybrid'].includes(name))) {
    reject('components', 'unsupported-component-set');
    return { schemaVersion: 1, state: 'incomparable', differences, components, deltas };
  }
  for (const name of names) {
    const before = differences.length, left = current?.components?.[name], right = baseline?.components?.[name];
    if (!left || !right) { reject('component', 'missing-component', name); continue; }
    for (const [side, value] of [['current', left], ['baseline', right]]) {
      const expectedScore = name === 'search-sparse' ? 'sparse' : name === 'search-hybrid' ? 'hybrid' : 'dense';
      if (value.scoreMode !== expectedScore) reject(`${side}.scoreMode`, 'component-score-workload-mismatch', name);
      const measured = value.work?.phases?.measured;
      if (!Number.isSafeInteger(value.samples) || value.samples <= 0 || !positive(value.totalTimeMs)
        || !metricKeys.every(key => positive(value[key]))) reject(`${side}.metrics`, 'missing-invalid-or-unsampled-metrics', name);
      const report = side === 'current' ? current : baseline;
      if (value.requestedBackend !== report?.backend) reject(`${side}.backend`, 'requested-backend-unknown-or-conflicting', name);
      if (value.samples % (report?.querySchedule?.count || 1) !== 0) reject(`${side}.schedule`, 'incomplete-measured-schedule-cycles', name);
      if (!measured || measured.samples !== value.samples || measured.qualified !== value.samples || measured.unqualified !== 0
        || measured.controlDrift !== 0 || !Array.isArray(measured.controls) || !measured.controls.length) reject(`${side}.execution`, 'work-incomplete-or-unqualified', name);
      const controls = Array.isArray(measured?.controls) ? measured.controls : [];
      if (controls.length !== report?.querySchedule?.count
        || new Set(controls.map(control => control?.queryIndex)).size !== controls.length
        || controls.some(control => !control || !Number.isSafeInteger(control.queryIndex) || control.queryIndex < 0 || control.queryIndex >= (report?.querySchedule?.count ?? 0))) {
        reject(`${side}.schedule`, 'measured-query-coverage-incomplete', name);
      }
      if (report.workMode === 'retrieval' && (measured?.cacheMisses !== value.samples || measured?.cacheHits !== 0
        || measured?.cacheUnknown !== 0 || value.scoreMode !== 'dense' && !(Number.isSafeInteger(measured?.candidateStages) && measured.candidateStages >= value.samples)
        || value.scoreMode !== 'sparse' && !(Number.isSafeInteger(measured?.vectorResultStages) && measured.vectorResultStages >= value.samples))) reject(`${side}.execution`, 'retrieval-work-counts-unqualified', name);
      if (report.workMode === 'result-cache' && (measured?.cacheHits !== value.samples || measured?.cacheMisses !== 0
        || measured?.cacheUnknown !== 0 || measured?.candidateStages !== 0 || measured?.vectorResultStages !== 0)) reject(`${side}.execution`, 'cache-work-counts-unqualified', name);
      if (!['queryEmbeddingRequests', 'queryEmbeddingApiCalls', 'queryEmbeddingCacheHits'].every(field => Number.isSafeInteger(measured?.[field]) && measured[field] >= 0)
        || measured.queryEmbeddingApiCalls + measured.queryEmbeddingCacheHits > measured.queryEmbeddingRequests
        || (report.workMode === 'result-cache' || value.scoreMode === 'sparse') && measured.queryEmbeddingRequests !== 0
        || report.workMode === 'retrieval' && value.scoreMode !== 'sparse' && measured.queryEmbeddingRequests < value.samples) {
        reject(`${side}.execution`, 'query-embedding-work-counts-unqualified', name);
      }
      for (const control of controls) {
        if (!control || typeof control !== 'object' || Array.isArray(control)) { reject(`${side}.controls`, 'invalid-control-row', name); continue; }
        if (!knownSource(control.source) || !/^sqp1-[a-f0-9]{64}$/.test(control.policyIdentity || '') || !/^mro1-[a-f0-9]{64}$/.test(control.outputIdentity || '')
          || !knownString(control.backend?.effective)) reject(`${side}.controls`, 'source-policy-backend-or-output-unknown', name);
        if (control.backend?.requested !== value.requestedBackend) reject(`${side}.backend`, 'control-requested-backend-conflict', name);
        if (control.cache?.enabled !== (report.workMode === 'result-cache') || control.cache?.hit !== (report.workMode === 'result-cache')
          || !knownString(control.cache?.strategy) || typeof control.cache?.memoryHotPath !== 'boolean') reject(`${side}.cache`, 'cache-policy-or-work-unqualified', name);
        if (!knownModel(control.model, value.scoreMode, report.workMode)) reject(`${side}.model`, 'runtime-model-identity-unknown', name);
        if (!isRetrievalExecution(control.execution, report.mode) || control.execution.status !== 'complete'
          || control.execution.requested.ann !== (value.scoreMode !== 'sparse')
          || value.scoreMode === 'sparse' && control.execution.effective.ann !== null) reject(`${side}.execution`, 'declared-score-work-does-not-match-execution', name);
        if (variedAxis === 'backend' && control.backend?.effective !== value.requestedBackend
          && !(['fts', 'sqlite-fts'].includes(value.requestedBackend) && control.backend?.effective === 'sqlite' && control.backend.sqliteFtsUsed === true)) {
          reject(`${side}.backend`, 'varied-backend-not-exercised', name);
        }
        if (variedAxis === 'ann-backend') {
          const requested = value.requestedAnnBackend;
          if (!knownString(requested) || control.backend?.requestedAnn !== value.requestedAnnBackend
            || !(Number.isSafeInteger(control.backend?.vectorProviders?.[requested]) && control.backend.vectorProviders[requested] > 0)) reject(`${side}.ann`, 'varied-ann-provider-not-exercised', name);
        }
      }
    }
    if (!same(left.scoreMode, right.scoreMode)) reject('scoreMode', 'score-workload-mismatch', name);
    const controlled = value => {
      const rows = value.work?.phases?.measured?.controls;
      return Array.isArray(rows) ? rows.map(control => !control || typeof control !== 'object' ? null : ({
        ...control, backend: variedAxis === 'backend'
          ? { vectorProviders: control.backend?.vectorProviders, requestedAnn: control.backend?.requestedAnn }
          : variedAxis === 'ann-backend' ? { requested: control.backend?.requested, effective: control.backend?.effective } : control.backend,
        execution: variedAxis === 'backend' && control.execution ? { ...control.execution,
          requested: { ann: control.execution.requested?.ann, reranker: control.execution.requested?.reranker },
          effective: { ann: control.execution.effective?.ann, reranker: control.execution.effective?.reranker } }
          : variedAxis === 'ann-backend' && control.execution ? { ...control.execution,
            effective: { sparse: control.execution.effective?.sparse, reranker: control.execution.effective?.reranker } } : control.execution
      })) : [];
    };
    if (!same(controlled(left), controlled(right))) reject('observed-controls', 'query-source-policy-model-output-or-effective-backend-mismatch', name);
    components[name] = { state: differences.length === before ? 'comparable' : 'incomparable' };
  }
  if (!differences.length) {
    for (const name of names) {
      const left = current.components[name], right = baseline.components[name];
      deltas[name] = Object.fromEntries(metricKeys.map(key => [key.replace('Ms', 'Pct'), ((left[key] - right[key]) / right[key]) * 100]));
    }
  }
  return { schemaVersion: 1, state: differences.length ? 'incomparable' : 'comparable',
    experiment: { kind: variedAxis ? 'explicit-controlled-axis' : 'same-workload-code-change', variedAxis },
    differences, components, deltas, qualification: 'workload-eligibility-only-statistical-qualification-separate' };
};
