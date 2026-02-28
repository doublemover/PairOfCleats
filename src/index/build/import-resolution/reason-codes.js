export const IMPORT_RESOLUTION_STATES = Object.freeze({
  RESOLVED: 'resolved',
  UNRESOLVED: 'unresolved'
});

export const IMPORT_FAILURE_CAUSES = Object.freeze({
  MISSING_FILE: 'missing_file',
  MISSING_DEPENDENCY: 'missing_dependency',
  GENERATED_EXPECTED_MISSING: 'generated_expected_missing',
  PARSER_ARTIFACT: 'parser_artifact',
  RESOLVER_GAP: 'resolver_gap',
  PARSE_ERROR: 'parse_error',
  UNKNOWN: 'unknown'
});

export const IMPORT_DISPOSITIONS = Object.freeze({
  ACTIONABLE: 'actionable',
  SUPPRESS_LIVE: 'suppress_live',
  SUPPRESS_GATE: 'suppress_gate'
});

export const IMPORT_RESOLVER_STAGES = Object.freeze({
  COLLECTOR: 'collector',
  NORMALIZE: 'normalize',
  LANGUAGE_RESOLVER: 'language_resolver',
  BUILD_SYSTEM_RESOLVER: 'build_system_resolver',
  FILESYSTEM_PROBE: 'filesystem_probe',
  CLASSIFY: 'classify'
});

export const IMPORT_REASON_CODES = Object.freeze({
  MISSING_FILE_RELATIVE: 'IMP_U_MISSING_FILE_RELATIVE',
  MISSING_DEPENDENCY_PACKAGE: 'IMP_U_MISSING_DEPENDENCY_PACKAGE',
  GENERATED_EXPECTED_MISSING: 'IMP_U_GENERATED_EXPECTED_MISSING',
  RESOLVER_BUDGET_EXHAUSTED: 'IMP_U_RESOLVER_BUDGET_EXHAUSTED',
  PARSER_NOISE_SUPPRESSED: 'IMP_U_PARSER_NOISE_SUPPRESSED',
  FIXTURE_REFERENCE: 'IMP_U_FIXTURE_REFERENCE',
  OPTIONAL_DEPENDENCY: 'IMP_U_OPTIONAL_DEPENDENCY',
  PATH_NORMALIZATION: 'IMP_U_PATH_NORMALIZATION',
  TYPO: 'IMP_U_TYPO',
  PARSE_ERROR: 'IMP_U_PARSE_ERROR',
  RESOLVER_GAP: 'IMP_U_RESOLVER_GAP',
  UNKNOWN: 'IMP_U_UNKNOWN'
});

export const IMPORT_REASON_DECISIONS = Object.freeze({
  [IMPORT_REASON_CODES.MISSING_FILE_RELATIVE]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.MISSING_FILE,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.FILESYSTEM_PROBE
  }),
  [IMPORT_REASON_CODES.MISSING_DEPENDENCY_PACKAGE]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.MISSING_DEPENDENCY,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER
  }),
  [IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.GENERATED_EXPECTED_MISSING,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_GATE,
    resolverStage: IMPORT_RESOLVER_STAGES.BUILD_SYSTEM_RESOLVER
  }),
  [IMPORT_REASON_CODES.RESOLVER_BUDGET_EXHAUSTED]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.RESOLVER_GAP,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_GATE,
    resolverStage: IMPORT_RESOLVER_STAGES.FILESYSTEM_PROBE
  }),
  [IMPORT_REASON_CODES.PARSER_NOISE_SUPPRESSED]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.PARSER_ARTIFACT,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_LIVE,
    resolverStage: IMPORT_RESOLVER_STAGES.CLASSIFY
  }),
  [IMPORT_REASON_CODES.FIXTURE_REFERENCE]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.PARSER_ARTIFACT,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_LIVE,
    resolverStage: IMPORT_RESOLVER_STAGES.CLASSIFY
  }),
  [IMPORT_REASON_CODES.OPTIONAL_DEPENDENCY]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.MISSING_DEPENDENCY,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_LIVE,
    resolverStage: IMPORT_RESOLVER_STAGES.CLASSIFY
  }),
  [IMPORT_REASON_CODES.PATH_NORMALIZATION]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.RESOLVER_GAP,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.NORMALIZE
  }),
  [IMPORT_REASON_CODES.TYPO]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.UNKNOWN,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.CLASSIFY
  }),
  [IMPORT_REASON_CODES.PARSE_ERROR]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.PARSE_ERROR,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.COLLECTOR
  }),
  [IMPORT_REASON_CODES.RESOLVER_GAP]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.RESOLVER_GAP,
    disposition: IMPORT_DISPOSITIONS.SUPPRESS_GATE,
    resolverStage: IMPORT_RESOLVER_STAGES.LANGUAGE_RESOLVER
  }),
  [IMPORT_REASON_CODES.UNKNOWN]: Object.freeze({
    failureCause: IMPORT_FAILURE_CAUSES.UNKNOWN,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: IMPORT_RESOLVER_STAGES.CLASSIFY
  })
});

export const isActionableDisposition = (value) => value === IMPORT_DISPOSITIONS.ACTIONABLE;

const NON_ACTIONABLE_FAILURE_CAUSES = new Set([
  IMPORT_FAILURE_CAUSES.PARSER_ARTIFACT,
  IMPORT_FAILURE_CAUSES.RESOLVER_GAP,
  IMPORT_FAILURE_CAUSES.GENERATED_EXPECTED_MISSING
]);
const KNOWN_REASON_CODES = new Set(Object.values(IMPORT_REASON_CODES));
const KNOWN_FAILURE_CAUSES = new Set(Object.values(IMPORT_FAILURE_CAUSES));
const KNOWN_DISPOSITIONS = new Set(Object.values(IMPORT_DISPOSITIONS));
const KNOWN_RESOLVER_STAGES = new Set(Object.values(IMPORT_RESOLVER_STAGES));

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
export const isKnownReasonCode = (value) => hasText(value) && KNOWN_REASON_CODES.has(value.trim());
export const isKnownFailureCause = (value) => hasText(value) && KNOWN_FAILURE_CAUSES.has(value.trim());
export const isKnownDisposition = (value) => hasText(value) && KNOWN_DISPOSITIONS.has(value.trim());
export const isKnownResolverStage = (value) => hasText(value) && KNOWN_RESOLVER_STAGES.has(value.trim());

export const resolveDecisionFromReasonCode = (reasonCode, {
  fallbackStage = IMPORT_RESOLVER_STAGES.CLASSIFY
} = {}) => {
  const normalizedCode = typeof reasonCode === 'string' ? reasonCode.trim() : '';
  const fromRegistry = normalizedCode ? IMPORT_REASON_DECISIONS[normalizedCode] : null;
  if (fromRegistry) {
    return {
      reasonCode: normalizedCode,
      failureCause: fromRegistry.failureCause,
      disposition: fromRegistry.disposition,
      resolverStage: fromRegistry.resolverStage
    };
  }
  return {
    reasonCode: IMPORT_REASON_CODES.UNKNOWN,
    failureCause: IMPORT_FAILURE_CAUSES.UNKNOWN,
    disposition: IMPORT_DISPOSITIONS.ACTIONABLE,
    resolverStage: fallbackStage
  };
};

export const createUnresolvedDecision = (reasonCode, options = {}) => {
  const decision = resolveDecisionFromReasonCode(reasonCode, options);
  return {
    resolutionState: IMPORT_RESOLUTION_STATES.UNRESOLVED,
    reasonCode: decision.reasonCode,
    failureCause: decision.failureCause,
    disposition: decision.disposition,
    resolverStage: decision.resolverStage
  };
};

export const normalizeUnresolvedDecision = (input = {}, options = {}) => {
  const normalizedReasonCode = isKnownReasonCode(input?.reasonCode)
    ? input.reasonCode.trim()
    : IMPORT_REASON_CODES.UNKNOWN;
  const seed = createUnresolvedDecision(normalizedReasonCode, options);
  const normalizedFailureCause = isKnownFailureCause(input?.failureCause)
    ? input.failureCause.trim()
    : seed.failureCause;
  let normalizedDisposition = isKnownDisposition(input?.disposition)
    ? input.disposition.trim()
    : seed.disposition;
  if (normalizedDisposition === IMPORT_DISPOSITIONS.ACTIONABLE
    && NON_ACTIONABLE_FAILURE_CAUSES.has(normalizedFailureCause)) {
    normalizedDisposition = seed.disposition;
  }
  const normalizedResolverStage = isKnownResolverStage(input?.resolverStage)
    ? input.resolverStage.trim()
    : seed.resolverStage;
  return {
    resolutionState: IMPORT_RESOLUTION_STATES.UNRESOLVED,
    reasonCode: seed.reasonCode,
    failureCause: normalizedFailureCause,
    disposition: normalizedDisposition,
    resolverStage: normalizedResolverStage
  };
};

export const validateResolutionDecision = (decision) => {
  const state = decision?.resolutionState;
  const errors = [];

  if (state !== IMPORT_RESOLUTION_STATES.RESOLVED && state !== IMPORT_RESOLUTION_STATES.UNRESOLVED) {
    errors.push(`invalid resolutionState: ${String(state)}`);
    return { ok: false, errors };
  }

  if (state === IMPORT_RESOLUTION_STATES.RESOLVED) {
    if (hasText(decision?.reasonCode)) errors.push('resolved decision must not include reasonCode');
    if (hasText(decision?.failureCause)) errors.push('resolved decision must not include failureCause');
    if (hasText(decision?.disposition)) errors.push('resolved decision must not include disposition');
    if (hasText(decision?.resolverStage)) errors.push('resolved decision must not include resolverStage');
    return { ok: errors.length === 0, errors };
  }

  if (!hasText(decision?.reasonCode)) errors.push('unresolved decision requires reasonCode');
  if (!hasText(decision?.failureCause)) errors.push('unresolved decision requires failureCause');
  if (!hasText(decision?.disposition)) errors.push('unresolved decision requires disposition');
  if (!hasText(decision?.resolverStage)) errors.push('unresolved decision requires resolverStage');
  if (hasText(decision?.reasonCode) && !KNOWN_REASON_CODES.has(decision.reasonCode)) {
    errors.push(`unresolved decision has unknown reasonCode=${String(decision.reasonCode)}`);
  }
  if (hasText(decision?.failureCause) && !KNOWN_FAILURE_CAUSES.has(decision.failureCause)) {
    errors.push(`unresolved decision has unknown failureCause=${String(decision.failureCause)}`);
  }
  if (hasText(decision?.disposition) && !KNOWN_DISPOSITIONS.has(decision.disposition)) {
    errors.push(`unresolved decision has unknown disposition=${String(decision.disposition)}`);
  }
  if (hasText(decision?.resolverStage) && !KNOWN_RESOLVER_STAGES.has(decision.resolverStage)) {
    errors.push(`unresolved decision has unknown resolverStage=${String(decision.resolverStage)}`);
  }

  if (decision?.disposition === IMPORT_DISPOSITIONS.ACTIONABLE
    && NON_ACTIONABLE_FAILURE_CAUSES.has(decision?.failureCause)) {
    errors.push(
      `disposition=actionable not allowed for failureCause=${String(decision?.failureCause)}`
    );
  }

  return { ok: errors.length === 0, errors };
};

export const assertUnresolvedDecision = (decision, { context = 'import-resolution' } = {}) => {
  if (decision?.resolutionState !== IMPORT_RESOLUTION_STATES.UNRESOLVED) {
    throw new Error(`[${context}] expected unresolved decision state`);
  }
  const validation = validateResolutionDecision(decision);
  if (validation.ok) return decision;
  throw new Error(
    `[${context}] invalid unresolved decision: ${validation.errors.join('; ')}`
  );
};
