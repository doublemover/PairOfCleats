import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { TEST_SUITE_CATEGORIES } from './suite-taxonomy.js';

const DEFAULT_GOVERNANCE_PATH = path.join('docs', 'testing', 'diagnostics-governance.json');

const normalizeId = (value) => String(value || '').trim().replace(/\\/g, '/');

export const normalizeDiagnosticsGovernance = (payload) => ({
  schemaVersion: Number(payload?.schemaVersion) || 0,
  instabilityClasses: Array.from(new Set(
    (Array.isArray(payload?.instabilityClasses) ? payload.instabilityClasses : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )),
  diagnosticsClasses: Array.from(new Set(
    (Array.isArray(payload?.diagnosticsClasses) ? payload.diagnosticsClasses : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )),
  expectedNegativeStderrIds: new Set(
    (Array.isArray(payload?.expectedNegativeStderrIds) ? payload.expectedNegativeStderrIds : [])
      .map((item) => normalizeId(item))
      .filter(Boolean)
  ),
  retryPolicyBySuiteCategory: Object.fromEntries(
    TEST_SUITE_CATEGORIES.map((category) => {
      const policy = payload?.retryPolicyBySuiteCategory?.[category];
      return [category, {
        maxRetries: Number.isFinite(Number(policy?.maxRetries)) ? Math.max(0, Math.floor(Number(policy.maxRetries))) : 0,
        quarantine: String(policy?.quarantine || '').trim(),
        note: String(policy?.note || '').trim()
      }];
    })
  )
});

export const validateDiagnosticsGovernance = (payload) => {
  const errors = [];
  if (payload.schemaVersion !== 1) {
    errors.push('expected schemaVersion=1');
  }
  for (const category of TEST_SUITE_CATEGORIES) {
    const policy = payload.retryPolicyBySuiteCategory?.[category];
    if (!policy) {
      errors.push(`missing retry policy for suite category ${category}`);
      continue;
    }
    if (!policy.quarantine) {
      errors.push(`retry policy for suite category ${category} missing quarantine`);
    }
    if (!policy.note) {
      errors.push(`retry policy for suite category ${category} missing note`);
    }
  }
  return {
    valid: errors.length === 0,
    errors
  };
};

export const loadDiagnosticsGovernance = async ({ root = process.cwd(), governancePath } = {}) => {
  const resolvedPath = governancePath
    ? path.resolve(root, governancePath)
    : path.join(root, DEFAULT_GOVERNANCE_PATH);
  const raw = await fsPromises.readFile(resolvedPath, 'utf8');
  const payload = normalizeDiagnosticsGovernance(JSON.parse(raw));
  const validation = validateDiagnosticsGovernance(payload);
  if (!validation.valid) {
    const error = new Error(`Invalid diagnostics governance payload: ${validation.errors.join('; ')}`);
    error.code = 'ERR_INVALID_DIAGNOSTICS_GOVERNANCE';
    throw error;
  }
  return {
    path: resolvedPath,
    payload
  };
};
