/**
 * Build release readiness scorecard rows/payload from operational readiness evaluation.
 *
 * @param {object} options
 * @param {object} [options.operationalReadinessPolicyPayload]
 * @param {object} [options.qualityGatesPayload]
 * @param {object} [options.languageProfilesPayload]
 * @param {object} [options.conformanceLevelsPayload]
 * @param {string[]} [options.knownLanes]
 * @param {string[]} [options.missingArtifactSchemas]
 * @param {string[]} [options.failingBlockingGateIds]
 * @param {string} [options.generatedAt]
 * @param {string} [options.producerId]
 * @param {string|null} [options.producerVersion]
 * @param {string} [options.runId]
 * @param {string} [options.lane]
 * @param {string|null} [options.buildId]
 * @param {{scopeType?:string,scopeId?:string}} [options.scope]
 * @param {(input:object)=>{ok:boolean,blocked:boolean,blockers:string[],errors:string[],warnings:string[],readiness:object,conformanceByLevel:Record<string,object>}} options.evaluateOperationalReadiness
 * @param {(scope:object,fallbackType:string,fallbackId:string)=>{scopeType:string,scopeId:string}} options.normalizeScope
 * @returns {{ok:boolean,blocked:boolean,blockers:string[],errors:string[],warnings:string[],rows:object[],payload:object}}
 */
export function buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-release-readiness-scorecard-builder',
  producerVersion = null,
  runId = 'run-usr-release-readiness-scorecard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' },
  evaluateOperationalReadiness,
  normalizeScope
} = {}) {
  const evaluation = evaluateOperationalReadiness({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds
  });

  const conformanceRows = Object.values(evaluation.conformanceByLevel || {}).map((summary) => ({
    rowType: 'conformance-level',
    id: summary.level,
    pass: summary.pass,
    requiredProfileCount: summary.requiredProfileCount,
    failingRequiredProfileCount: summary.failingRequiredProfileCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount
  }));

  const readinessRows = [
    {
      rowType: 'readiness-dimension',
      id: 'test-rollout',
      pass: !evaluation.readiness.testRolloutBlocked,
      blocked: evaluation.readiness.testRolloutBlocked
    },
    {
      rowType: 'readiness-dimension',
      id: 'deep-conformance',
      pass: !evaluation.readiness.deepConformanceBlocked,
      blocked: evaluation.readiness.deepConformanceBlocked
    },
    {
      rowType: 'readiness-dimension',
      id: 'framework-conformance',
      pass: !evaluation.readiness.frameworkConformanceBlocked,
      blocked: evaluation.readiness.frameworkConformanceBlocked
    }
  ];

  const rows = [...readinessRows, ...conformanceRows];
  const status = evaluation.errors.length > 0 || evaluation.blocked
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-release-readiness-scorecard',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeScope(scope, 'lane', lane),
    summary: {
      blocked: evaluation.blocked,
      blockerCount: evaluation.blockers.length,
      errorCount: evaluation.errors.length,
      warningCount: evaluation.warnings.length,
      readiness: evaluation.readiness,
      conformanceByLevel: evaluation.conformanceByLevel
    },
    blockingFindings: [
      ...evaluation.blockers.map((message) => ({ class: 'release-readiness', message })),
      ...evaluation.errors.map((message) => ({ class: 'release-readiness', message }))
    ],
    advisoryFindings: evaluation.warnings.map((message) => ({ class: 'release-readiness', message })),
    rows
  };

  return {
    ok: evaluation.ok,
    blocked: evaluation.blocked,
    blockers: evaluation.blockers,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}
