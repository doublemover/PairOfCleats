import { CONTEXT_PACK_RISK_CONTRACT_VERSION } from '../../contracts/context-pack-risk-contract.js';

export const buildRiskArtifactStatus = ({ presence, required = false, loadFailed = false }) => {
  if (loadFailed) return 'load_failed';
  const missing = presence?.format === 'missing' || presence?.missingMeta || presence?.missingPaths?.length > 0;
  if (missing) return required ? 'missing' : 'not_required';
  return 'present';
};

export const classifyRiskLoadFailure = (err) => {
  const code = typeof err?.code === 'string' ? err.code : '';
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  if (
    code === 'ETIMEDOUT'
    || code === 'ERR_ARTIFACT_TIMEOUT'
    || code === 'ERR_SUBPROCESS_TIMEOUT'
    || message.includes('timed out')
    || message.includes('timeout')
  ) {
    return 'timed_out';
  }
  if (
    code === 'ERR_ARTIFACT_INVALID'
    || code === 'ERR_JSONL_INVALID'
    || code === 'ERR_MANIFEST_INVALID'
    || code === 'ERR_MANIFEST_INCOMPLETE'
    || code === 'ERR_MANIFEST_ENTRY_MISSING'
    || code === 'ERR_MANIFEST_SOURCE_AMBIGUOUS'
    || message.includes('invalid json')
    || message.includes('schema validation failed')
    || message.includes('invalid columnar payload')
    || message.includes('invalid json payload')
  ) {
    return 'schema_invalid';
  }
  return 'degraded';
};

export const normalizeRiskArtifactRefs = (stats) => {
  const artifacts = stats?.artifacts;
  if (!artifacts || typeof artifacts !== 'object') return null;
  const refs = {
    stats: artifacts.stats || null,
    summaries: artifacts.summaries || artifacts.riskSummaries || null,
    flows: artifacts.flows || artifacts.riskFlows || null,
    partialFlows: artifacts.partialFlows || artifacts.riskPartialFlows || null,
    callSites: artifacts.callSites || null
  };
  return Object.values(refs).some(Boolean) ? refs : null;
};

export const normalizeRiskRuleBundle = (stats) => {
  const ruleBundle = stats?.provenance?.ruleBundle;
  if (!ruleBundle || typeof ruleBundle !== 'object') return null;
  const roleModel = ruleBundle.roleModel && typeof ruleBundle.roleModel === 'object'
    ? ruleBundle.roleModel
    : {
      version: '1.0.0',
      directRoles: ['source', 'sink', 'sanitizer'],
      propagatorLikeRoles: ['propagator', 'wrapper', 'builder', 'callback', 'asyncHandoff'],
      propagatorLikeEncoding: 'watch-semantics'
    };
  return {
    version: ruleBundle.version || null,
    fingerprint: ruleBundle.fingerprint || null,
    roleModel: {
      version: roleModel.version || null,
      directRoles: Array.isArray(roleModel.directRoles) ? roleModel.directRoles.filter(Boolean) : [],
      propagatorLikeRoles: Array.isArray(roleModel.propagatorLikeRoles)
        ? roleModel.propagatorLikeRoles.filter(Boolean)
        : [],
      propagatorLikeEncoding: roleModel.propagatorLikeEncoding || null
    },
    provenance: ruleBundle.provenance && typeof ruleBundle.provenance === 'object'
      ? {
        defaults: ruleBundle.provenance.defaults === true,
        sourcePath: ruleBundle.provenance.sourcePath || null
      }
      : null
  };
};

export const normalizeRiskProvenance = ({
  manifest,
  stats,
  artifactStatus,
  indexSignature = null,
  indexCompatKey = null
}) => ({
  manifestVersion: Number.isFinite(manifest?.version) ? manifest.version : null,
  artifactSurfaceVersion: manifest?.artifactSurfaceVersion || null,
  compatibilityKey: manifest?.compatibilityKey || indexCompatKey || null,
  indexSignature: indexSignature || stats?.provenance?.indexSignature || null,
  indexCompatKey: indexCompatKey || manifest?.compatibilityKey || stats?.provenance?.indexCompatKey || null,
  mode: stats?.mode || null,
  generatedAt: stats?.generatedAt || null,
  ruleBundle: normalizeRiskRuleBundle(stats),
  effectiveConfigFingerprint: stats?.provenance?.effectiveConfigFingerprint || null,
  artifacts: artifactStatus,
  artifactRefs: normalizeRiskArtifactRefs(stats)
});

export const normalizeRiskPathNodes = (flow) => {
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  return chunkUids.map((chunkUid) => ({ type: 'chunk', chunkUid }));
};

export const buildRiskAnalysisStatus = ({
  status,
  reason,
  degraded,
  summaryOnly,
  code = 'ok',
  strictFailure = false,
  artifactStatus,
  stats,
  caps,
  degradedReasons
}) => ({
  requested: true,
  status,
  reason,
  degraded,
  summaryOnly,
  code,
  strictFailure,
  artifactStatus,
  degradedReasons,
  flowsEmitted: stats?.flowsEmitted ?? null,
  partialFlowsEmitted: stats?.partialFlowsEmitted ?? null,
  uniqueCallSitesReferenced: stats?.uniqueCallSitesReferenced ?? null,
  capsHit: Array.from(
    new Set([
      ...(Array.isArray(stats?.capsHit) ? stats.capsHit : []),
      ...(Array.isArray(caps?.hits) ? caps.hits : [])
    ])
  )
});

export const withRiskContractVersion = (riskPayload) => ({
  ...riskPayload,
  contractVersion: CONTEXT_PACK_RISK_CONTRACT_VERSION
});
