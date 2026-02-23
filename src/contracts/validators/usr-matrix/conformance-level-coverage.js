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

/**
 * Validates target conformance-level coverage for all language profiles.
 *
 * @param {object} [input]
 * @param {string} [input.targetLevel]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {ReadonlyArray<string>} input.conformanceLevels
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(knownLanes:unknown)=>Record<string,string>} input.buildConformanceLaneByLevel
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrConformanceLevelCoverage({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  conformanceLevels,
  validateRegistry,
  buildConformanceLaneByLevel
} = {}) {
  if (!Array.isArray(conformanceLevels)) {
    return emptyValidationResult(['conformanceLevels callback input is required']);
  }
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }
  if (typeof buildConformanceLaneByLevel !== 'function') {
    return emptyValidationResult(['buildConformanceLaneByLevel callback is required']);
  }

  const level = typeof targetLevel === 'string' ? targetLevel : '';
  if (!conformanceLevels.includes(level)) {
    return emptyValidationResult([`unsupported target conformance level: ${targetLevel}`]);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyValidationResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const conformanceValidation = validateRegistry('usr-conformance-levels', conformanceLevelsPayload);
  if (!conformanceValidation?.ok) {
    return emptyValidationResult(conformanceValidation?.errors || ['invalid usr-conformance-levels payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const knownLaneSet = new Set(asStringArray(knownLanes));
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const expectedLane = conformanceLaneByLevel[level];
  if (knownLaneSet.size > 0 && !knownLaneSet.has(expectedLane)) {
    errors.push(`missing lane for conformance level ${level}: ${expectedLane}`);
  }

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const conformanceRows = Array.isArray(conformanceLevelsPayload?.rows) ? conformanceLevelsPayload.rows : [];
  const languageConformanceRows = conformanceRows.filter((row) => row.profileType === 'language');
  const conformanceByLanguageId = new Map(languageConformanceRows.map((row) => [row.profileId, row]));

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const requiresLevel = asStringArray(languageRow.requiredConformance).includes(level);
    const conformanceRow = conformanceByLanguageId.get(languageRow.id);
    if (!conformanceRow) {
      rowErrors.push('missing conformance-levels row for language profile');
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
      rows.push({
        profileId: languageRow.id,
        targetLevel: level,
        requiresLevel,
        hasConformanceRow: false,
        pass: false,
        errors: Object.freeze([...rowErrors]),
        warnings: Object.freeze([...rowWarnings])
      });
      continue;
    }

    const requiredLevels = asStringArray(conformanceRow.requiredLevels);
    const blockingLevels = asStringArray(conformanceRow.blockingLevels);
    const requiredFixtureFamilies = asStringArray(conformanceRow.requiredFixtureFamilies);

    if (requiresLevel && !requiredLevels.includes(level)) {
      rowErrors.push(`requiredLevels missing target level ${level}`);
    }

    if (requiresLevel && !blockingLevels.includes(level)) {
      rowErrors.push(`blockingLevels missing target level ${level}`);
    }

    if (requiresLevel && requiredFixtureFamilies.length === 0) {
      rowErrors.push('requiredFixtureFamilies must not be empty for required level');
    }

    if (requiresLevel && !requiredFixtureFamilies.includes('golden')) {
      rowWarnings.push('requiredFixtureFamilies should include golden for deterministic conformance evidence');
    }

    if (requiresLevel && level === 'C1' && !requiredFixtureFamilies.includes('resolution')) {
      rowWarnings.push('requiredFixtureFamilies should include resolution for C1 baseline evidence');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }

    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    rows.push({
      profileId: languageRow.id,
      targetLevel: level,
      requiresLevel,
      hasConformanceRow: true,
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
