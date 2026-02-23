const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const emptyValidationResult = (errors, warnings = []) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([...warnings]),
  rows: Object.freeze([])
});

/**
 * Validates matrix-driven harness coherence across language/framework profiles,
 * fixture-governance coverage, and language-batch shard assignment.
 *
 * @param {object} [input]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.frameworkProfilesPayload]
 * @param {object} [input.fixtureGovernancePayload]
 * @param {object} [input.batchShardsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateLanguageBatchShards
 * @param {(knownLanes:unknown)=>Record<string,string>} input.buildConformanceLaneByLevel
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload,
  frameworkProfilesPayload,
  fixtureGovernancePayload,
  batchShardsPayload,
  knownLanes = [],
  validateRegistry,
  validateLanguageBatchShards,
  buildConformanceLaneByLevel
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }
  if (typeof validateLanguageBatchShards !== 'function') {
    return emptyValidationResult(['validateLanguageBatchShards callback is required']);
  }
  if (typeof buildConformanceLaneByLevel !== 'function') {
    return emptyValidationResult(['buildConformanceLaneByLevel callback is required']);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyValidationResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const frameworkValidation = validateRegistry('usr-framework-profiles', frameworkProfilesPayload);
  if (!frameworkValidation?.ok) {
    return emptyValidationResult(frameworkValidation?.errors || ['invalid usr-framework-profiles payload']);
  }

  const fixtureValidation = validateRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!fixtureValidation?.ok) {
    return emptyValidationResult(fixtureValidation?.errors || ['invalid usr-fixture-governance payload']);
  }

  const batchValidation = validateLanguageBatchShards({
    batchShardsPayload,
    languageProfilesPayload
  });
  if (!batchValidation.ok) {
    return emptyValidationResult(batchValidation.errors, batchValidation.warnings);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const frameworkRows = Array.isArray(frameworkProfilesPayload?.rows) ? frameworkProfilesPayload.rows : [];
  const fixtureRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const batchRows = Array.isArray(batchShardsPayload?.rows) ? batchShardsPayload.rows : [];

  const knownLaneSet = new Set(asStringArray(knownLanes));
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const languageById = new Map(languageRows.map((row) => [row.id, row]));
  const languageFixtureIds = new Set(
    fixtureRows
      .filter((row) => row.profileType === 'language')
      .map((row) => row.profileId)
  );
  const frameworkFixtureIds = new Set(
    fixtureRows
      .filter((row) => row.profileType === 'framework')
      .map((row) => row.profileId)
  );

  const batchByLanguageId = new Map();
  for (const batchRow of batchRows) {
    if (batchRow.scopeType !== 'language-batch') {
      continue;
    }
    for (const languageId of asStringArray(batchRow.languageIds)) {
      batchByLanguageId.set(languageId, batchRow.id);
    }
  }

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if (!batchByLanguageId.has(languageRow.id)) {
      rowErrors.push('language profile is missing language-batch shard assignment');
    }

    if (!languageFixtureIds.has(languageRow.id)) {
      rowWarnings.push('language profile is missing fixture-governance coverage');
    }

    const requiredConformance = asStringArray(languageRow.requiredConformance);
    if (requiredConformance.length === 0) {
      rowErrors.push('language profile requiredConformance must not be empty');
    }

    for (const conformanceLevel of requiredConformance) {
      const expectedLane = conformanceLaneByLevel[conformanceLevel];
      if (!expectedLane) {
        rowErrors.push(`unsupported requiredConformance level: ${conformanceLevel}`);
        continue;
      }
      if (knownLaneSet.size > 0 && !knownLaneSet.has(expectedLane)) {
        rowErrors.push(`missing lane for requiredConformance ${conformanceLevel}: ${expectedLane}`);
      }
    }

    if (asStringArray(languageRow.frameworkProfiles).length > 0 && !requiredConformance.includes('C4')) {
      rowWarnings.push('language profile with framework overlays should include C4 conformance requirement');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    rows.push({
      profileType: 'language',
      profileId: languageRow.id,
      batchId: batchByLanguageId.get(languageRow.id) || null,
      hasFixtureCoverage: languageFixtureIds.has(languageRow.id),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const frameworkRow of frameworkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const appliesToLanguages = asStringArray(frameworkRow.appliesToLanguages);
    if (appliesToLanguages.length === 0) {
      rowErrors.push('framework profile appliesToLanguages must not be empty');
    }

    if (!frameworkFixtureIds.has(frameworkRow.id)) {
      rowWarnings.push('framework profile is missing fixture-governance coverage');
    }

    for (const languageId of appliesToLanguages) {
      const languageRow = languageById.get(languageId);
      if (!languageRow) {
        rowErrors.push(`framework appliesToLanguages references unknown language: ${languageId}`);
        continue;
      }
      const languageFrameworks = asStringArray(languageRow.frameworkProfiles);
      if (!languageFrameworks.includes(frameworkRow.id)) {
        rowErrors.push(`framework mapping missing inverse language profile linkage: ${languageId}`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${frameworkRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${frameworkRow.id} ${message}`));
    }

    rows.push({
      profileType: 'framework',
      profileId: frameworkRow.id,
      batchId: null,
      hasFixtureCoverage: frameworkFixtureIds.has(frameworkRow.id),
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
