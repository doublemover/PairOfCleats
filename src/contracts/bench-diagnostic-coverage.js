export const BENCH_PARITY_OBSERVATION_VERSION = 2;
const count = value => Number.isSafeInteger(value) && value >= 0;
const fields = ['logStreams', 'diagnosticStreams', 'pairedSources', 'expectedStreams', 'observedStreams', 'missingStreams',
  'unpairedSources', 'malformedDiagnosticLines', 'unknownDiagnosticEvents', 'incompleteStreams', 'inventoryErrors', 'producerIncompleteTasks'];

/** Captured input observations, not absence-of-event inference or a statistical
 * guarantee. An observed quiet pair is valid; an absent pair is unobserved.
 */
export const validateBenchDiagnosticCoverage = value => {
  const errors = [], fail = message => { if (errors.length < 32) errors.push(message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['diagnostic stream coverage is required'] };
  if (value.schemaVersion !== 1 || value.expectedSourcePolicy !== 'captured-log-diagnostic-pairs-and-declared-process-paths-v1') fail('unsupported diagnostic coverage contract');
  for (const field of fields) if (!count(value[field])) fail(`coverage.${field} must be an exact nonnegative count`);
  for (const [sample, total, omitted] of [['missingSamples', 'missingStreams', 'missingSamplesOmitted'], ['unpairedSamples', 'unpairedSources', 'unpairedSamplesOmitted']]) {
    const rows = value[sample];
    if (!Array.isArray(rows) || rows.length > 8 || rows.some(row => typeof row !== 'string' || !row.length)
      || !count(value[omitted]) || rows.length + value[omitted] !== value[total]) fail(`coverage.${sample} does not explain its complete count`);
  }
  if (fields.every(field => count(value[field]))) {
    if (value.observedStreams !== value.logStreams + value.diagnosticStreams
      || value.expectedStreams !== value.observedStreams + value.missingStreams
      || value.pairedSources > Math.min(value.logStreams, value.diagnosticStreams)
      || value.unpairedSources !== value.observedStreams - 2 * value.pairedSources) fail('diagnostic stream inventory counts disagree');
    const complete = value.pairedSources > 0 && !value.missingStreams && !value.unpairedSources && !value.malformedDiagnosticLines
      && !value.unknownDiagnosticEvents && !value.incompleteStreams && !value.inventoryErrors && !value.producerIncompleteTasks;
    const expected = complete ? 'complete' : value.observedStreams === 0 ? 'unobserved' : 'incomplete';
    if (value.state !== expected) fail('diagnostic coverage state disagrees with its observations');
  }
  return { ok: !errors.length, errors };
};
