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

