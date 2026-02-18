import fsSync from 'node:fs';

export const HEALTH_CHECK_CODES = Object.freeze({
  INDEX_MODE_INVALID: 'op_health_index_mode_invalid',
  INDEX_BUILD_ROOT_MISSING: 'op_health_index_build_root_missing',
  INDEX_OUTPUT_UNWRITABLE: 'op_health_index_output_unwritable',
  RETRIEVAL_QUERY_EMPTY: 'op_health_retrieval_query_empty',
  RETRIEVAL_MODE_MISSING: 'op_health_retrieval_mode_missing',
  RETRIEVAL_BACKEND_MISSING: 'op_health_retrieval_backend_missing'
});

const INDEX_MODES = new Set(['code', 'prose', 'records', 'extracted-prose']);

const toText = (value) => String(value || '').trim();

const makeCheck = ({
  ok,
  code,
  component,
  reason,
  nextAction,
  severity = 'error'
}) => ({
  ok: ok === true,
  code: toText(code),
  component: toText(component),
  reason: toText(reason),
  nextAction: toText(nextAction),
  severity
});

const summarizeChecks = (checks) => {
  const list = Array.isArray(checks) ? checks : [];
  const failures = list.filter((check) => check?.ok !== true);
  return {
    ok: failures.length === 0,
    checks: list,
    failures
  };
};

const canWritePath = (pathValue) => {
  const target = toText(pathValue);
  if (!target) return false;
  try {
    fsSync.accessSync(target, fsSync.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Run lightweight indexing health checks with stable machine-readable codes.
 * @param {object} input
 * @returns {{ok:boolean,checks:Array<object>,failures:Array<object>}}
 */
export const runIndexingHealthChecks = ({
  mode,
  runtime,
  outDir
} = {}) => {
  const checks = [];
  checks.push(makeCheck({
    ok: INDEX_MODES.has(mode),
    code: HEALTH_CHECK_CODES.INDEX_MODE_INVALID,
    component: 'indexing',
    reason: `Unsupported indexing mode: ${toText(mode) || '(empty)'}`,
    nextAction: 'Use one of code|prose|records|extracted-prose.'
  }));
  checks.push(makeCheck({
    ok: Boolean(toText(runtime?.buildRoot)),
    code: HEALTH_CHECK_CODES.INDEX_BUILD_ROOT_MISSING,
    component: 'indexing',
    reason: 'Build root is missing from runtime envelope.',
    nextAction: 'Initialize runtime with a valid build root before indexing.'
  }));
  checks.push(makeCheck({
    ok: canWritePath(outDir),
    code: HEALTH_CHECK_CODES.INDEX_OUTPUT_UNWRITABLE,
    component: 'indexing',
    reason: `Output directory is not writable: ${toText(outDir) || '(empty)'}`,
    nextAction: 'Check permissions or choose a writable index root.'
  }));
  return summarizeChecks(checks);
};

/**
 * Run retrieval health checks before hot-path execution.
 * @param {object} input
 * @returns {{ok:boolean,checks:Array<object>,failures:Array<object>}}
 */
export const runRetrievalHealthChecks = ({
  query,
  runCode,
  runProse,
  runExtractedProse,
  runRecords,
  backendLabel
} = {}) => {
  const checks = [];
  checks.push(makeCheck({
    ok: Boolean(toText(query)),
    code: HEALTH_CHECK_CODES.RETRIEVAL_QUERY_EMPTY,
    component: 'retrieval',
    reason: 'Search query is empty.',
    nextAction: 'Provide a non-empty query string.'
  }));
  checks.push(makeCheck({
    ok: Boolean(runCode || runProse || runExtractedProse || runRecords),
    code: HEALTH_CHECK_CODES.RETRIEVAL_MODE_MISSING,
    component: 'retrieval',
    reason: 'No retrieval mode is enabled.',
    nextAction: 'Enable at least one mode (code/prose/extracted-prose/records).'
  }));
  checks.push(makeCheck({
    ok: Boolean(toText(backendLabel)),
    code: HEALTH_CHECK_CODES.RETRIEVAL_BACKEND_MISSING,
    component: 'retrieval',
    reason: 'Resolved backend label is missing.',
    nextAction: 'Resolve backend policy before executing retrieval.'
  }));
  return summarizeChecks(checks);
};

/**
 * Format a health-check failure as an actionable single-line log record.
 * @param {object} failure
 * @returns {string}
 */
export const formatHealthFailure = (failure) => (
  `[health] code=${toText(failure?.code)} component=${toText(failure?.component)} `
  + `reason="${toText(failure?.reason)}" next="${toText(failure?.nextAction)}"`
);
