const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const resolveReportStatus = ({ errors = [], warnings = [] }) => (
  errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass')
);

const normalizeScopeWithFallback = (
  scope,
  fallbackScopeType = 'lane',
  fallbackScopeId = 'ci'
) => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

const emptyBuildResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([]),
  payload: null
});

/**
 * Builds language conformance dashboard report across all conformance levels.
 *
 * @param {object} [input]
 * @param {object} [input.languageProfilesPayload]
 * @param {object} [input.conformanceLevelsPayload]
 * @param {string[]} [input.knownLanes]
 * @param {string} [input.generatedAt]
 * @param {string} [input.producerId]
 * @param {string|null} [input.producerVersion]
 * @param {string} [input.runId]
 * @param {string} [input.lane]
 * @param {string|null} [input.buildId]
 * @param {{scopeType?:string,scopeId?:string}} [input.scope]
 * @param {string[]} input.conformanceDashboardLevels
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(input:object)=>{coverageByLevel:Map<string,{evaluation:object,rowsByProfileId:Map<string,object>}>,errors:string[],warnings:string[]}} input.buildCoverageMapByLevel
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateConformanceLevelCoverage
 * @param {(scope:unknown,fallbackScopeType?:string,fallbackScopeId?:string)=>{scopeType:string,scopeId:string}} [input.normalizeScope]
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,payload:object|null}}
 */
export function buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-language-conformance-dashboard',
  producerVersion = null,
  runId = 'run-usr-language-conformance-dashboard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  conformanceDashboardLevels,
  validateRegistry,
  buildCoverageMapByLevel,
  validateConformanceLevelCoverage,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  if (!Array.isArray(conformanceDashboardLevels)) {
    return emptyBuildResult(['conformanceDashboardLevels callback input is required']);
  }
  if (typeof validateRegistry !== 'function') {
    return emptyBuildResult(['validateRegistry callback is required']);
  }
  if (typeof buildCoverageMapByLevel !== 'function') {
    return emptyBuildResult(['buildCoverageMapByLevel callback is required']);
  }
  if (typeof validateConformanceLevelCoverage !== 'function') {
    return emptyBuildResult(['validateConformanceLevelCoverage callback is required']);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyBuildResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const conformanceValidation = validateRegistry('usr-conformance-levels', conformanceLevelsPayload);
  if (!conformanceValidation?.ok) {
    return emptyBuildResult(conformanceValidation?.errors || ['invalid usr-conformance-levels payload']);
  }

  const { coverageByLevel, errors, warnings } = buildCoverageMapByLevel({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    levels: conformanceDashboardLevels,
    validateConformanceLevelCoverage
  });

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const rows = [];
  const levelCoverage = Object.fromEntries(
    conformanceDashboardLevels.map((level) => [level, { requiredCount: 0, passingRequiredCount: 0 }])
  );
  let passCount = 0;

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const requiredLevels = asStringArray(languageRow.requiredConformance);
    const levelStatus = {};

    for (const level of conformanceDashboardLevels) {
      const coverage = coverageByLevel.get(level);
      const coverageRow = coverage?.rowsByProfileId?.get(languageRow.id) || null;
      if (!coverageRow) {
        rowErrors.push(`missing conformance coverage row for level ${level}`);
        levelStatus[level] = {
          requiresLevel: requiredLevels.includes(level),
          pass: false,
          hasCoverageRow: false
        };
        continue;
      }

      levelStatus[level] = {
        requiresLevel: coverageRow.requiresLevel,
        pass: coverageRow.pass,
        hasCoverageRow: true
      };

      if (requiredLevels.includes(level)) {
        levelCoverage[level].requiredCount += 1;
        if (coverageRow.pass) {
          levelCoverage[level].passingRequiredCount += 1;
        } else {
          rowErrors.push(`required level ${level} is failing`);
        }
      }

      if (coverageRow.warnings.length > 0) {
        rowWarnings.push(...coverageRow.warnings.map((message) => `${level} ${message}`));
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    const pass = rowErrors.length === 0;
    if (pass) {
      passCount += 1;
    }

    rows.push({
      rowType: 'language-conformance-dashboard',
      profileId: languageRow.id,
      requiredLevels,
      frameworkProfiles: asStringArray(languageRow.frameworkProfiles),
      levelStatus,
      pass,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-conformance-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status: resolveReportStatus({ errors, warnings }),
    scope: normalizeScope(scope, 'lane', lane),
    summary: {
      dashboard: 'language-conformance',
      profileCount: rows.length,
      passCount,
      failCount: rows.length - passCount,
      warningCount: warnings.length,
      errorCount: errors.length,
      levelCoverage
    },
    blockingFindings: errors.map((message) => ({
      class: 'conformance',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'conformance',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows),
    payload
  };
}
