import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';

export const normalizeProviderId = (value) => String(value || '').trim().toLowerCase();

export const PREFLIGHT_POLICY = Object.freeze({
  REQUIRED: 'required',
  OPTIONAL: 'optional'
});

export const PROVIDER_FIDELITY_STATE = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  QUARANTINED: 'quarantined'
});

export const PROVIDER_FIDELITY_CONTRACT_VERSION = 1;

const PROVIDER_REQUEST_CLASS_METHODS = Object.freeze({
  documentSymbol: 'textDocument/documentSymbol',
  hover: 'textDocument/hover',
  semanticTokens: 'textDocument/semanticTokens/full',
  signatureHelp: 'textDocument/signatureHelp',
  inlayHints: 'textDocument/inlayHint',
  definition: 'textDocument/definition',
  typeDefinition: 'textDocument/typeDefinition',
  references: 'textDocument/references'
});

const normalizeRuntimeRequirement = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim().toLowerCase();
  const cmd = String(entry.cmd || entry.command || '').trim();
  if (!id || !cmd) return null;
  const label = String(entry.label || id).trim() || id;
  return {
    id,
    cmd,
    args: Array.isArray(entry.args)
      ? entry.args.map((value) => String(value))
      : ['--version'],
    label
  };
};

export const normalizePreflightPolicy = (value, fallback = PREFLIGHT_POLICY.OPTIONAL) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === PREFLIGHT_POLICY.REQUIRED) return PREFLIGHT_POLICY.REQUIRED;
  if (normalized === PREFLIGHT_POLICY.OPTIONAL) return PREFLIGHT_POLICY.OPTIONAL;
  return fallback === PREFLIGHT_POLICY.REQUIRED
    ? PREFLIGHT_POLICY.REQUIRED
    : PREFLIGHT_POLICY.OPTIONAL;
};

export const isPreflightPolicy = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === PREFLIGHT_POLICY.REQUIRED || normalized === PREFLIGHT_POLICY.OPTIONAL;
};

export const normalizePreflightRuntimeRequirements = (value) => {
  if (!Array.isArray(value)) return [];
  const requirements = [];
  const seen = new Set();
  for (const entry of value) {
    const normalized = normalizeRuntimeRequirement(entry);
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    requirements.push(normalized);
  }
  return requirements;
};

export const hashProviderConfig = (config) => {
  const normalized = config && typeof config === 'object' ? config : {};
  return sha1(stableStringify(normalized));
};

export const buildDuplicateChunkUidChecks = (targets, options = {}) => {
  const seen = new Set();
  const dupes = new Set();
  const label = typeof options.label === 'string' && options.label.trim()
    ? options.label.trim()
    : 'tooling';
  const maxSamples = Number.isFinite(Number(options.maxSamples))
    ? Math.max(0, Math.floor(Number(options.maxSamples)))
    : 3;
  for (const target of Array.isArray(targets) ? targets : []) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    const chunkUid = chunkRef?.chunkUid || target?.chunkUid || null;
    if (!chunkUid) continue;
    if (seen.has(chunkUid)) {
      dupes.add(chunkUid);
      continue;
    }
    seen.add(chunkUid);
  }
  if (!dupes.size) return [];
  const samples = Array.from(dupes).slice(0, maxSamples);
  const suffix = samples.length ? `: ${samples.join(', ')}` : '';
  return [{
    name: 'duplicate_chunk_uid',
    status: 'warn',
    message: `${label} provider received ${dupes.size} duplicate chunkUid target(s)${suffix}`,
    count: dupes.size,
    samples
  }];
};

const hasNamedCheck = (checks, name) => (
  Array.isArray(checks) && checks.some((check) => check?.name === name)
);

const uniqueStringList = (values) => {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

const normalizeFidelityState = (value, fallback = PROVIDER_FIDELITY_STATE.HEALTHY) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (Object.values(PROVIDER_FIDELITY_STATE).includes(normalized)) return normalized;
  return fallback;
};

const countByChunkUidEntries = (value) => {
  if (value instanceof Map) return value.size;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

const summarizeBlockedPartitions = ({
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = []
} = {}) => {
  const keys = uniqueStringList(blockedWorkspaceKeys);
  const roots = uniqueStringList(blockedWorkspaceRoots);
  return {
    count: Math.max(keys.length, roots.length),
    workspaceKeys: keys,
    workspaceRoots: roots
  };
};

const summarizeCapabilityGateSkips = (runtime) => {
  const requested = runtime?.capabilityGate?.requested && typeof runtime.capabilityGate.requested === 'object'
    ? runtime.capabilityGate.requested
    : null;
  const effective = runtime?.capabilityGate?.effective && typeof runtime.capabilityGate.effective === 'object'
    ? runtime.capabilityGate.effective
    : null;
  if (!requested || !effective) return [];
  const skipped = [];
  for (const requestClass of Object.keys(PROVIDER_REQUEST_CLASS_METHODS)) {
    if (requested[requestClass] === true && effective[requestClass] === false) {
      skipped.push(requestClass);
    }
  }
  return skipped;
};

export const summarizeProviderRequestClasses = (runtime) => {
  const byMethod = runtime?.requests?.byMethod && typeof runtime.requests.byMethod === 'object'
    ? runtime.requests.byMethod
    : {};
  const summary = Object.create(null);
  for (const [requestClass, methodName] of Object.entries(PROVIDER_REQUEST_CLASS_METHODS)) {
    const entry = byMethod?.[methodName] && typeof byMethod[methodName] === 'object'
      ? byMethod[methodName]
      : {};
    summary[requestClass] = {
      requests: Number(entry.requests || 0),
      failed: Number(entry.failed || 0),
      timedOut: Number(entry.timedOut || 0)
    };
  }
  return summary;
};

export const buildProviderFidelityContract = ({
  providerId,
  state = null,
  reasonCode = null,
  preflightState = null,
  workspaceRootRel = null,
  workspaceKey = null,
  fingerprint = null,
  runtime = null,
  checks = [],
  captureDiagnostics = false,
  blockedWorkspaceKeys = [],
  blockedWorkspaceRoots = [],
  skippedRequestClasses = [],
  byChunkUid = null,
  contributes = null,
  downstreamMergeInterpretation = null
} = {}) => {
  const requestClasses = summarizeProviderRequestClasses(runtime);
  const blockedPartitions = summarizeBlockedPartitions({
    blockedWorkspaceKeys,
    blockedWorkspaceRoots
  });
  const requestClassFailures = Object.entries(requestClasses)
    .filter(([, metrics]) => Number(metrics?.timedOut || 0) > 0 || Number(metrics?.failed || 0) > 0)
    .map(([requestClass]) => requestClass);
  const derivedQuarantined = hasNamedCheck(checks, 'tooling_provider_quarantined')
    || hasNamedCheck(checks, 'pyright_quarantined_for_run');
  const derivedBlocked = String(preflightState || '').trim().toLowerCase() === 'blocked';
  const derivedDegraded = String(preflightState || '').trim().toLowerCase() === 'degraded'
    || blockedPartitions.count > 0
    || requestClassFailures.length > 0
    || hasNamedCheck(checks, 'tooling_document_symbol_failed')
    || hasNamedCheck(checks, 'pyright_timeout_storm_truncated');
  const effectiveState = normalizeFidelityState(
    state,
    derivedBlocked
      ? PROVIDER_FIDELITY_STATE.BLOCKED
      : (derivedQuarantined
        ? PROVIDER_FIDELITY_STATE.QUARANTINED
        : (derivedDegraded ? PROVIDER_FIDELITY_STATE.DEGRADED : PROVIDER_FIDELITY_STATE.HEALTHY))
  );
  const normalizedSkipped = uniqueStringList([
    ...skippedRequestClasses,
    ...summarizeCapabilityGateSkips(runtime)
  ]);
  const contributedChunkCount = countByChunkUidEntries(byChunkUid);
  const resolvedContributes = contributes && typeof contributes === 'object'
    ? {
      typeEnrichment: contributes.typeEnrichment === true,
      diagnostics: contributes.diagnostics === true
    }
    : {
      typeEnrichment: effectiveState !== PROVIDER_FIDELITY_STATE.BLOCKED
        && effectiveState !== PROVIDER_FIDELITY_STATE.QUARANTINED,
      diagnostics: captureDiagnostics === true
        && effectiveState !== PROVIDER_FIDELITY_STATE.BLOCKED
    };
  const partialSuccess = (
    effectiveState === PROVIDER_FIDELITY_STATE.DEGRADED
    && (
      contributedChunkCount > 0
      || blockedPartitions.count > 0
      || requestClassFailures.length > 0
      || normalizedSkipped.length > 0
    )
  );
  const mergeInterpretation = String(downstreamMergeInterpretation || '').trim() || (
    effectiveState === PROVIDER_FIDELITY_STATE.HEALTHY
      ? 'Provider output is healthy and may participate in normal merge scoring.'
      : (
        effectiveState === PROVIDER_FIDELITY_STATE.DEGRADED
          ? 'Treat present provider output as partial contribution; do not treat blocked partitions or skipped request classes as negative evidence.'
          : 'Treat missing provider output as explicit provider degradation or unavailability, not as negative evidence.'
      )
  );
  return {
    contractVersion: PROVIDER_FIDELITY_CONTRACT_VERSION,
    providerId: normalizeProviderId(providerId) || String(providerId || '').trim(),
    state: effectiveState,
    reasonCode: String(reasonCode || '').trim() || null,
    workspaceRootRel: String(workspaceRootRel || '').trim() || null,
    workspaceKey: String(workspaceKey || '').trim() || null,
    fingerprint: String(fingerprint || '').trim() || null,
    contributes: resolvedContributes,
    requestClasses,
    blockedPartitions,
    skipped: normalizedSkipped,
    qualityDelta: {
      partialSuccess,
      contributedChunkCount,
      degradedRequestClasses: requestClassFailures,
      skippedRequestClasses: normalizedSkipped,
      blockedPartitionCount: blockedPartitions.count
    },
    downstreamMergeInterpretation: mergeInterpretation
  };
};

export const appendDiagnosticChecks = (diagnostics, checks) => {
  if (!Array.isArray(checks) || !checks.length) return diagnostics || null;
  const next = diagnostics && typeof diagnostics === 'object' ? { ...diagnostics } : {};
  const existing = Array.isArray(next.checks) ? next.checks : [];
  next.checks = [...existing, ...checks];
  return next;
};

export const shouldCaptureDiagnosticsForRequestedKinds = (requestedKinds) => {
  if (!Array.isArray(requestedKinds) || !requestedKinds.length) return true;
  return requestedKinds.some((entry) => String(entry || '').trim().toLowerCase() === 'diagnostics');
};

export const validateToolingProvider = (provider) => {
  if (!provider || typeof provider !== 'object') return 'provider missing';
  if (!normalizeProviderId(provider.id)) return 'provider.id missing';
  if (!provider.version) return 'provider.version missing';
  if (!provider.capabilities || typeof provider.capabilities !== 'object') return 'provider.capabilities missing';
  if (provider.languages && !Array.isArray(provider.languages)) return 'provider.languages must be array';
  if (provider.kinds && !Array.isArray(provider.kinds)) return 'provider.kinds must be array';
  if (provider.preflightPolicy) {
    if (!isPreflightPolicy(provider.preflightPolicy)) return 'provider.preflightPolicy invalid';
  }
  if (provider.preflightRuntimeRequirements && !Array.isArray(provider.preflightRuntimeRequirements)) {
    return 'provider.preflightRuntimeRequirements must be array';
  }
  if (typeof provider.getConfigHash !== 'function') return 'provider.getConfigHash missing';
  if (typeof provider.run !== 'function') return 'provider.run missing';
  return null;
};
