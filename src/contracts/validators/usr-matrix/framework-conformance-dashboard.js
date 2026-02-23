const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const sortedStrings = (value) => [...asStringArray(value)].sort((left, right) => left.localeCompare(right));

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
 * Builds framework conformance dashboard report with C4 language coverage.
 *
 * @param {object} [input]
 * @param {object} [input.frameworkProfilesPayload]
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
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @param {(input:object)=>{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}} input.validateConformanceLevelCoverage
 * @param {(scope:unknown,fallbackScopeType?:string,fallbackScopeId?:string)=>{scopeType:string,scopeId:string}} [input.normalizeScope]
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>,payload:object|null}}
 */
export function buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-framework-conformance-dashboard',
  producerVersion = null,
  runId = 'run-usr-framework-conformance-dashboard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  validateRegistry,
  validateConformanceLevelCoverage,
  normalizeScope = normalizeScopeWithFallback
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyBuildResult(['validateRegistry callback is required']);
  }
  if (typeof validateConformanceLevelCoverage !== 'function') {
    return emptyBuildResult(['validateConformanceLevelCoverage callback is required']);
  }

  const frameworkValidation = validateRegistry('usr-framework-profiles', frameworkProfilesPayload);
  if (!frameworkValidation?.ok) {
    return emptyBuildResult(frameworkValidation?.errors || ['invalid usr-framework-profiles payload']);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyBuildResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const c4Coverage = validateConformanceLevelCoverage({
    targetLevel: 'C4',
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes
  });

  const errors = [...c4Coverage.errors.map((message) => `C4 ${message}`)];
  const warnings = [...c4Coverage.warnings.map((message) => `C4 ${message}`)];
  const rows = [];

  const frameworkRows = Array.isArray(frameworkProfilesPayload?.rows) ? frameworkProfilesPayload.rows : [];
  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const languageById = new Map(languageRows.map((row) => [row.id, row]));
  const c4ByLanguageId = new Map((c4Coverage.rows || []).map((row) => [row.profileId, row]));
  let passCount = 0;

  for (const frameworkRow of frameworkRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const appliesToLanguages = asStringArray(frameworkRow.appliesToLanguages);
    const failingLanguages = [];

    if (appliesToLanguages.length === 0) {
      rowErrors.push('appliesToLanguages must not be empty');
    }

    for (const languageId of appliesToLanguages) {
      const languageRow = languageById.get(languageId);
      if (!languageRow) {
        rowErrors.push(`unknown language in appliesToLanguages: ${languageId}`);
        continue;
      }

      const languageFrameworkProfiles = asStringArray(languageRow.frameworkProfiles);
      if (!languageFrameworkProfiles.includes(frameworkRow.id)) {
        rowErrors.push(`inverse language frameworkProfiles linkage is missing for ${languageId}`);
      }

      const coverageRow = c4ByLanguageId.get(languageId);
      if (!coverageRow) {
        rowErrors.push(`missing C4 coverage row for ${languageId}`);
        failingLanguages.push(languageId);
        continue;
      }

      if (coverageRow.requiresLevel && !coverageRow.pass) {
        rowErrors.push(`C4 required coverage is failing for ${languageId}`);
        failingLanguages.push(languageId);
      } else if (!coverageRow.requiresLevel) {
        rowWarnings.push(`language ${languageId} does not require C4 despite framework applicability`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${frameworkRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${frameworkRow.id} ${message}`));
    }

    const pass = rowErrors.length === 0;
    if (pass) {
      passCount += 1;
    }

    rows.push({
      rowType: 'framework-conformance-dashboard',
      profileId: frameworkRow.id,
      appliesToLanguages,
      failingLanguages: sortedStrings(failingLanguages),
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
      dashboard: 'framework-conformance',
      profileCount: rows.length,
      passCount,
      failCount: rows.length - passCount,
      warningCount: warnings.length,
      errorCount: errors.length
    },
    blockingFindings: errors.map((message) => ({
      class: 'framework-conformance',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'framework-conformance',
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
