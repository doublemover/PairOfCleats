const DEFAULT_SCOPE = Object.freeze({
  scopeType: 'global',
  scopeId: 'global'
});

const normalizeScope = (scope) => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
    }
    : { ...DEFAULT_SCOPE }
);

/**
 * Validate runtime feature-flag combinations that are disallowed by rollout policy.
 *
 * Failure contract:
 * - In strict mode, disallowed combinations are blocking errors.
 * - In non-strict mode, disallowed combinations are advisory warnings.
 *
 * @param {{values?:Record<string, unknown>, strictMode?:boolean}} [input]
 * @returns {{ok:boolean, errors:ReadonlyArray<string>, warnings:ReadonlyArray<string>}}
 */
export function validateUsrFeatureFlagConflicts({
  values = {},
  strictMode = true
} = {}) {
  const errors = [];
  const warnings = [];

  const addConflict = (message) => {
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  };

  const cutoverEnabled = values['usr.rollout.cutoverEnabled'] === true;
  const shadowReadEnabled = values['usr.rollout.shadowReadEnabled'] === true;
  if (cutoverEnabled && shadowReadEnabled) {
    addConflict('disallowed feature-flag conflict: usr.rollout.cutoverEnabled and usr.rollout.shadowReadEnabled cannot both be true');
  }

  if (strictMode && values['usr.strictMode.enabled'] === false) {
    errors.push('disallowed feature-flag value in strict mode: usr.strictMode.enabled cannot be false');
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings])
  };
}

/**
 * Build a USR runtime-config state report from resolved config values and conflict checks.
 *
 * Precedence contract:
 * - Effective values and source attribution are delegated to `resolveRuntimeConfig`.
 * - This preserves layer precedence (`policy-file` < `env` < `argv`) and keeps last valid value
 *   when a higher-precedence override fails coercion.
 *
 * Failure contract:
 * - All resolver errors/warnings are preserved and combined with conflict findings.
 * - Findings are never downgraded or suppressed inside this builder.
 *
 * @param {{
 *   policyPayload?:object,
 *   layers?:{policyFile?:object,env?:object,argv?:object},
 *   strictMode?:boolean,
 *   generatedAt?:string,
 *   producerId?:string,
 *   producerVersion?:string|null,
 *   runId?:string,
 *   lane?:string,
 *   buildId?:string|null,
 *   scope?:{scopeType?:string,scopeId?:string},
 *   resolveRuntimeConfig?:(input?:object)=>{
 *     ok:boolean,
 *     errors:ReadonlyArray<string>,
 *     warnings:ReadonlyArray<string>,
 *     values:Readonly<Record<string, unknown>>,
 *     appliedByKey:Readonly<Record<string, string>>
 *   }
 * }} [input]
 * @returns {{
 *   ok:boolean,
 *   errors:ReadonlyArray<string>,
 *   warnings:ReadonlyArray<string>,
 *   values:Readonly<Record<string, unknown>>,
 *   appliedByKey:Readonly<Record<string, string>>,
 *   payload:object
 * }}
 */
export function buildUsrFeatureFlagStateReport({
  policyPayload,
  layers = {},
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-runtime-config-validator',
  producerVersion = null,
  runId = 'run-usr-feature-flag-state',
  lane = 'ci',
  buildId = null,
  scope = DEFAULT_SCOPE,
  resolveRuntimeConfig = () => ({
    ok: false,
    errors: Object.freeze(['missing resolveRuntimeConfig callback']),
    warnings: Object.freeze([]),
    values: Object.freeze({}),
    appliedByKey: Object.freeze({})
  })
} = {}) {
  const resolved = resolveRuntimeConfig({
    policyPayload,
    layers,
    strictMode
  });

  const conflictValidation = validateUsrFeatureFlagConflicts({
    values: resolved.values,
    strictMode
  });

  const errors = [
    ...resolved.errors,
    ...conflictValidation.errors
  ];
  const warnings = [
    ...resolved.warnings,
    ...conflictValidation.warnings
  ];

  const policyRows = Array.isArray(policyPayload?.rows) ? policyPayload.rows : [];
  const rows = policyRows.map((row) => ({
    id: row.id,
    key: row.key,
    value: resolved.values[row.key],
    source: resolved.appliedByKey[row.key] || 'default',
    valueType: row.valueType,
    rolloutClass: row.rolloutClass,
    strictModeBehavior: row.strictModeBehavior,
    requiresRestart: Boolean(row.requiresRestart),
    blocking: Boolean(row.blocking)
  }));

  const status = errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-feature-flag-state',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeScope(scope),
    summary: {
      strictMode,
      keyCount: rows.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      conflictCount: conflictValidation.errors.length + conflictValidation.warnings.length
    },
    blockingFindings: errors.map((message) => ({
      class: 'runtime-config',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'runtime-config',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    values: resolved.values,
    appliedByKey: resolved.appliedByKey,
    payload
  };
}
