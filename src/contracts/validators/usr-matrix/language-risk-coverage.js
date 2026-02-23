const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const emptyValidationResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

const findRiskOverlap = (left, right) => {
  const rightSet = new Set(asStringArray(right));
  return asStringArray(left).filter((item) => rightSet.has(item));
};

/**
 * Validates language risk-profile matrices for taxonomy consistency,
 * capability gating, and framework/base row coverage.
 *
 * @param {object} [input]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.languageRiskProfilesPayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload,
  languageRiskProfilesPayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyValidationResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const riskValidation = validateRegistry('usr-language-risk-profiles', languageRiskProfilesPayload);
  if (!riskValidation?.ok) {
    return emptyValidationResult(riskValidation?.errors || ['invalid usr-language-risk-profiles payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const riskRows = Array.isArray(languageRiskProfilesPayload?.rows) ? languageRiskProfilesPayload.rows : [];

  const languageIdSet = new Set(languageRows.map((row) => row.id));
  const riskRowCounts = new Map();
  const baseRowByLanguageId = new Map();

  for (const row of riskRows) {
    const frameworkProfile = typeof row.frameworkProfile === 'string' ? row.frameworkProfile : null;
    const key = `${row.languageId}::${frameworkProfile ?? 'base'}`;
    riskRowCounts.set(key, (riskRowCounts.get(key) || 0) + 1);

    if (frameworkProfile == null && !baseRowByLanguageId.has(row.languageId)) {
      baseRowByLanguageId.set(row.languageId, row);
    }
  }

  for (const languageId of languageIdSet) {
    if (!baseRowByLanguageId.has(languageId)) {
      errors.push(`${languageId} missing base risk profile row (frameworkProfile=null)`);
    }
  }

  for (const row of riskRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const frameworkProfile = typeof row.frameworkProfile === 'string' ? row.frameworkProfile : null;
    const rowKey = `${row.languageId}::${frameworkProfile ?? 'base'}`;
    if ((riskRowCounts.get(rowKey) || 0) > 1) {
      rowErrors.push('duplicate risk profile row for language/framework pair');
    }

    if (!languageIdSet.has(row.languageId)) {
      rowErrors.push('risk profile references unknown languageId');
    }

    const requiredSources = asStringArray(row?.required?.sources);
    const requiredSinks = asStringArray(row?.required?.sinks);
    const requiredSanitizers = asStringArray(row?.required?.sanitizers);
    const optionalSources = asStringArray(row?.optional?.sources);
    const optionalSinks = asStringArray(row?.optional?.sinks);
    const optionalSanitizers = asStringArray(row?.optional?.sanitizers);
    const unsupportedSources = asStringArray(row?.unsupported?.sources);
    const unsupportedSinks = asStringArray(row?.unsupported?.sinks);
    const unsupportedSanitizers = asStringArray(row?.unsupported?.sanitizers);

    const capabilities = row.capabilities || {};
    const riskLocal = typeof capabilities.riskLocal === 'string' ? capabilities.riskLocal : 'unsupported';
    const riskInterprocedural = typeof capabilities.riskInterprocedural === 'string' ? capabilities.riskInterprocedural : 'unsupported';

    const overlapRequiredOptional = [
      ...findRiskOverlap(requiredSources, optionalSources),
      ...findRiskOverlap(requiredSinks, optionalSinks),
      ...findRiskOverlap(requiredSanitizers, optionalSanitizers)
    ];
    if (overlapRequiredOptional.length > 0) {
      rowErrors.push(`required and optional taxonomy entries overlap: ${[...new Set(overlapRequiredOptional)].join(', ')}`);
    }

    const overlapUnsupported = [
      ...findRiskOverlap(requiredSources, unsupportedSources),
      ...findRiskOverlap(optionalSources, unsupportedSources),
      ...findRiskOverlap(requiredSinks, unsupportedSinks),
      ...findRiskOverlap(optionalSinks, unsupportedSinks),
      ...findRiskOverlap(requiredSanitizers, unsupportedSanitizers),
      ...findRiskOverlap(optionalSanitizers, unsupportedSanitizers)
    ];
    if (overlapUnsupported.length > 0) {
      rowErrors.push(`supported and unsupported taxonomy entries overlap: ${[...new Set(overlapUnsupported)].join(', ')}`);
    }

    const interproceduralGating = row.interproceduralGating || {};
    const minEvidenceKinds = asStringArray(interproceduralGating.minEvidenceKinds);
    const enabledByDefault = interproceduralGating.enabledByDefault === true;

    if (riskInterprocedural === 'unsupported' && enabledByDefault) {
      rowErrors.push('interproceduralGating.enabledByDefault must be false when riskInterprocedural=unsupported');
    }

    if (riskInterprocedural !== 'unsupported' && minEvidenceKinds.length === 0) {
      rowErrors.push('interprocedural profiles require non-empty interproceduralGating.minEvidenceKinds');
    }

    if (riskLocal === 'supported' && (requiredSources.length === 0 || requiredSinks.length === 0)) {
      rowErrors.push('riskLocal=supported requires non-empty required.sources and required.sinks');
    }

    if (riskLocal === 'partial' && requiredSanitizers.length === 0) {
      rowWarnings.push('riskLocal=partial should include at least one required sanitizer class');
    }

    const severityLevels = asStringArray(row?.severityPolicy?.levels);
    const defaultSeverity = row?.severityPolicy?.defaultLevel;
    if (typeof defaultSeverity !== 'string' || !severityLevels.includes(defaultSeverity)) {
      rowErrors.push('severityPolicy.defaultLevel must be present in severityPolicy.levels');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.languageId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.languageId} ${message}`));
    }

    rows.push({
      languageId: row.languageId,
      frameworkProfile,
      riskLocal,
      riskInterprocedural,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}
