const ownValue = (value, key) => value && (typeof value === 'object' || typeof value === 'function')
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;

/** Recover only the command's explicit analyzed-policy failures. Load, schema,
 * artifact-write and internal errors retain their original failure boundary.
 * Both successful and policy-failed reports use the same validation/emission.
 */
export const emitReportOutcome = async ({ build, validate, emit, emitArtifact = null, policyCodes = [], label = 'Report' }) => {
  let report, policyFailure = null;
  try { report = await build(); }
  catch (error) {
    const code = ownValue(error, 'code'), attached = ownValue(error, 'report');
    if (!policyCodes.includes(code) || !attached || typeof attached !== 'object') throw error;
    report = attached; policyFailure = error;
  }
  const validation = validate(report);
  if (!validation.ok) throw Object.assign(new Error(`${label} schema validation failed: ${validation.errors.join('; ')}`),
    { code: 'ERR_REPORT_SCHEMA' });
  // Requested artifacts use their existing atomic writer, before stdout. A
  // failed write is an ordinary failure, not a completed policy verdict.
  if (emitArtifact) await emitArtifact(report);
  await emit(report);
  if (policyFailure) throw policyFailure;
  return report;
};

/** A versioned input diagnostic is deliberately distinct from an analyzed
 * report. Human entrypoints retain their existing single stderr diagnostic.
 */
export const admitReportInput = (admit, { format, inputCodes = [] } = {}) => {
  try { return admit(); }
  catch (error) {
    const code = ownValue(error, 'code');
    if (format === 'json' && inputCodes.includes(code)) {
      const diagnostic = { version: '1.0.0', error: { code, message: ownValue(error, 'message') || 'Report input rejected.',
        ruleId: ownValue(error, 'ruleId') ?? null, ruleIndex: ownValue(error, 'ruleIndex') ?? null,
        propertyPath: ownValue(error, 'propertyPath') ?? null } };
      console.log(JSON.stringify(diagnostic, null, 2));
    }
    throw error;
  }
};
