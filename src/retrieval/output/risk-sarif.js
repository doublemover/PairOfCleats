import { buildRiskExplanationModelFromRiskSlice } from '../../shared/risk-explain.js';

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';
const DEFAULT_URI_BASE_ID = 'REPO_ROOT';
const DEFAULT_RULE_ID = 'pairofcleats/risk-flow';

const toSarifPathUri = (filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  return filePath.replace(/\\/g, '/');
};

const buildSarifRegion = (details) => {
  if (!details || typeof details !== 'object') return null;
  const region = {};
  if (Number.isFinite(details.startLine)) region.startLine = details.startLine;
  if (Number.isFinite(details.startCol)) region.startColumn = details.startCol;
  if (Number.isFinite(details.endLine)) region.endLine = details.endLine;
  if (Number.isFinite(details.endCol)) region.endColumn = details.endCol;
  return Object.keys(region).length ? region : null;
};

const buildSarifPhysicalLocation = (details, { uriBaseId = DEFAULT_URI_BASE_ID } = {}) => {
  const uri = toSarifPathUri(details?.file);
  if (!uri) return null;
  const physicalLocation = {
    artifactLocation: {
      uri,
      uriBaseId
    }
  };
  const region = buildSarifRegion(details);
  if (region) physicalLocation.region = region;
  return physicalLocation;
};

const formatSarifStepMessage = (details, fallbackId) => {
  if (details && typeof details === 'object') {
    const callee = details.calleeNormalized || details.calleeRaw || null;
    const args = Array.isArray(details.args) && details.args.length ? `(${details.args.join(', ')})` : '';
    const invocation = callee ? `${callee}${args}` : null;
    const excerpt = typeof details.excerpt === 'string' ? details.excerpt.replace(/\s+/g, ' ').trim() : '';
    const file = typeof details.file === 'string' && details.file.trim() ? details.file.trim() : null;
    const loc = Number.isFinite(details.startLine)
      ? `${details.startLine}:${Number.isFinite(details.startCol) ? details.startCol : 1}`
      : null;
    const parts = [];
    if (file) parts.push(loc ? `${file}:${loc}` : file);
    if (invocation) parts.push(invocation);
    if (excerpt && excerpt !== invocation) parts.push(excerpt);
    if (parts.length) return parts.join(' ');
  }
  return fallbackId || 'risk flow step';
};

const collectFlowSteps = (flow, maxEvidencePerFlow) => {
  const evidenceSteps = Array.isArray(flow?.evidence?.callSitesByStep)
    ? flow.evidence.callSitesByStep
    : Array.isArray(flow?.callSitesByStep)
      ? flow.callSitesByStep
      : [];
  const rawIds = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
  const rawWatchSteps = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
  const count = Math.max(evidenceSteps.length, rawIds.length, rawWatchSteps.length);
  const locations = [];
  for (let index = 0; index < count; index += 1) {
    const evidence = Array.isArray(evidenceSteps[index]) ? evidenceSteps[index] : [];
    const ids = Array.isArray(rawIds[index]) ? rawIds[index] : [];
    const watchWindow = rawWatchSteps[index] || null;
    const limited = evidence.length
      ? evidence.slice(0, maxEvidencePerFlow)
      : ids.slice(0, maxEvidencePerFlow).map((callSiteId) => ({ callSiteId }));
    if (!limited.length && !watchWindow) continue;
    if (!limited.length) {
      locations.push({
        step: index + 1,
        ordinal: locations.length + 1,
        evidenceIndex: 0,
        callSiteId: null,
        details: null,
        watchWindow,
        message: `risk flow step ${index + 1}`
      });
      continue;
    }
    limited.forEach((entry, entryIndex) => {
      locations.push({
        step: index + 1,
        ordinal: locations.length + 1,
        evidenceIndex: entryIndex,
        callSiteId: entry?.callSiteId || ids[entryIndex] || null,
        details: entry?.details || null,
        watchWindow,
        message: formatSarifStepMessage(entry?.details || null, entry?.callSiteId || ids[entryIndex] || null)
      });
    });
  }
  return locations;
};

const normalizeWatchWindow = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  return {
    taintIn: Array.isArray(entry.taintIn) ? entry.taintIn.filter(Boolean) : [],
    taintOut: Array.isArray(entry.taintOut) ? entry.taintOut.filter(Boolean) : [],
    propagatedArgIndices: Array.isArray(entry.propagatedArgIndices)
      ? entry.propagatedArgIndices.filter((value) => Number.isFinite(value))
      : [],
    boundParams: Array.isArray(entry.boundParams) ? entry.boundParams.filter(Boolean) : [],
    calleeNormalized: entry.calleeNormalized || null,
    sanitizerPolicy: entry.sanitizerPolicy || null,
    sanitizerBarrierApplied: entry.sanitizerBarrierApplied === true,
    sanitizerBarriersBefore: Number.isFinite(entry.sanitizerBarriersBefore) ? entry.sanitizerBarriersBefore : null,
    sanitizerBarriersAfter: Number.isFinite(entry.sanitizerBarriersAfter) ? entry.sanitizerBarriersAfter : null,
    confidenceBefore: Number.isFinite(entry.confidenceBefore) ? entry.confidenceBefore : null,
    confidenceAfter: Number.isFinite(entry.confidenceAfter) ? entry.confidenceAfter : null,
    confidenceDelta: Number.isFinite(entry.confidenceDelta) ? entry.confidenceDelta : null
  };
};

const buildThreadFlowLocation = (flowStep, { uriBaseId = DEFAULT_URI_BASE_ID } = {}) => {
  const location = {
    message: { text: flowStep.message },
    executionOrder: flowStep.ordinal,
    properties: {
      pairOfCleats: {
        callSiteId: flowStep.callSiteId || null,
        evidenceIndex: flowStep.evidenceIndex,
        step: flowStep.step,
        watchWindow: normalizeWatchWindow(flowStep.watchWindow)
      }
    }
  };
  const physicalLocation = buildSarifPhysicalLocation(flowStep.details, { uriBaseId });
  if (physicalLocation) {
    location.location = { physicalLocation };
  }
  return location;
};

const buildResultLocation = (flowSteps, { uriBaseId = DEFAULT_URI_BASE_ID } = {}) => {
  for (let index = flowSteps.length - 1; index >= 0; index -= 1) {
    const physicalLocation = buildSarifPhysicalLocation(flowSteps[index]?.details, { uriBaseId });
    if (!physicalLocation) continue;
    return [{
      physicalLocation,
      message: { text: flowSteps[index].message }
    }];
  }
  return undefined;
};

const buildResultMessage = (flow) => {
  const parts = [];
  if (flow?.category) parts.push(flow.category);
  const sourceRule = flow?.source?.ruleId || flow?.sourceRule || null;
  const sinkRule = flow?.sink?.ruleId || flow?.sinkRule || null;
  if (sourceRule || sinkRule) {
    parts.push(`${sourceRule || 'source'} -> ${sinkRule || 'sink'}`);
  }
  return parts.length ? parts.join(' | ') : 'PairOfCleats risk flow';
};

const buildFlowResult = (flow, index, { uriBaseId = DEFAULT_URI_BASE_ID, maxEvidencePerFlow = 3 } = {}) => {
  const flowSteps = collectFlowSteps(flow, maxEvidencePerFlow);
  const result = {
    ruleId: DEFAULT_RULE_ID,
    ruleIndex: 0,
    level: 'warning',
    kind: 'review',
    message: { text: buildResultMessage(flow) },
    partialFingerprints: {
      pairOfCleatsFlowId: flow?.flowId || `flow-${index + 1}`
    },
    codeFlows: [{
      threadFlows: [{
        id: flow?.flowId || `flow-${index + 1}`,
        locations: flowSteps.map((step) => buildThreadFlowLocation(step, { uriBaseId }))
      }]
    }],
    properties: {
      pairOfCleats: {
        flowId: flow?.flowId || null,
        confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
        category: flow?.category || null,
        sourceRuleId: flow?.source?.ruleId || null,
        sinkRuleId: flow?.sink?.ruleId || null,
        source: flow?.source || null,
        sink: flow?.sink || null,
        path: flow?.path || null
      }
    }
  };
  const locations = buildResultLocation(flowSteps, { uriBaseId });
  if (locations) result.locations = locations;
  return result;
};

const buildPartialFlowCompanion = (partialFlows, { maxPartialFlows = 3, maxEvidencePerFlow = 3 } = {}) => {
  const list = Array.isArray(partialFlows) ? partialFlows : [];
  const limited = list.slice(0, maxPartialFlows).map((flow) => ({
    partialFlowId: flow?.partialFlowId || null,
    confidence: Number.isFinite(flow?.confidence) ? flow.confidence : null,
    source: flow?.source || null,
    frontier: flow?.frontier || null,
    path: flow?.path || null,
    notes: flow?.notes || null,
    blockedExpansions: Array.isArray(flow?.frontier?.blockedExpansions)
      ? flow.frontier.blockedExpansions.slice(0, maxEvidencePerFlow).map((entry) => ({
        targetChunkUid: entry?.targetChunkUid || null,
        reason: entry?.reason || null,
        callSiteIds: Array.isArray(entry?.callSiteIds) ? entry.callSiteIds.filter(Boolean) : []
      }))
      : []
  }));
  return {
    partialFlowSelection: {
      totalPartialFlows: list.length,
      shownPartialFlows: limited.length,
      omittedPartialFlows: Math.max(0, list.length - limited.length),
      maxPartialFlows,
      maxEvidencePerFlow
    },
    partialFlows: limited
  };
};

export const renderRiskExplanationSarif = (model, {
  uriBaseId = DEFAULT_URI_BASE_ID,
  maxFlows = 3,
  maxPartialFlows = 3,
  maxEvidencePerFlow = 3,
  automationId = 'risk-explain',
  origin = 'risk-explain'
} = {}) => {
  const flows = Array.isArray(model?.flows) ? model.flows.slice(0, maxFlows) : [];
  const partialCompanion = buildPartialFlowCompanion(model?.partialFlows, { maxPartialFlows, maxEvidencePerFlow });
  return {
    $schema: SARIF_SCHEMA_URL,
    version: SARIF_VERSION,
    runs: [{
      tool: {
        driver: {
          name: 'PairOfCleats',
          informationUri: 'https://github.com/doublemover/PairOfCleats',
          rules: [{
            id: DEFAULT_RULE_ID,
            shortDescription: { text: 'Interprocedural risk flow' },
            fullDescription: { text: 'PairOfCleats exported interprocedural risk flow.' },
            properties: {
              tags: ['security', 'dataflow', 'pairofcleats']
            }
          }]
        }
      },
      automationDetails: { id: automationId },
      properties: {
        pairOfCleats: {
          origin,
          subject: model?.subject || null,
          anchor: model?.anchor || null,
          analysisStatus: model?.analysisStatus || null,
          summary: model?.summary || null,
          stats: model?.stats || null,
          provenance: model?.provenance || null,
          caps: model?.caps || null,
          truncation: Array.isArray(model?.truncation) ? model.truncation.slice() : [],
          filters: model?.filters || null,
          flowSelection: {
            totalFlows: Array.isArray(model?.flows) ? model.flows.length : 0,
            shownFlows: flows.length,
            omittedFlows: Math.max(0, (Array.isArray(model?.flows) ? model.flows.length : 0) - flows.length),
            maxFlows,
            maxEvidencePerFlow
          },
          partialFlowSelection: partialCompanion.partialFlowSelection,
          partialFlows: partialCompanion.partialFlows
        }
      },
      results: flows.map((flow, index) => buildFlowResult(flow, index, { uriBaseId, maxEvidencePerFlow }))
    }]
  };
};

export const renderCompositeContextPackSarif = (payload, options = {}) => {
  const model = buildRiskExplanationModelFromRiskSlice(payload?.risk || null, {
    subject: payload?.primary?.ref?.type === 'chunk'
      ? {
        chunkUid: payload.primary.ref.chunkUid || null,
        file: payload.primary.file || null,
        name: null,
        kind: null
      }
      : {
        chunkUid: null,
        file: payload?.primary?.file || null,
        name: null,
        kind: null
      }
  });
  const sarif = renderRiskExplanationSarif(model, {
    automationId: 'context-pack',
    origin: 'context-pack',
    ...options
  });
  const run = sarif.runs?.[0];
  if (run) {
    const existing = run.properties?.pairOfCleats || {};
    run.properties = {
      ...(run.properties || {}),
      pairOfCleats: {
        ...existing,
        packWarnings: Array.isArray(payload?.warnings) ? payload.warnings.slice() : [],
        packTruncation: Array.isArray(payload?.truncation) ? payload.truncation.slice() : [],
        primary: payload?.primary || null,
        seed: payload?.seed || null,
        packProvenance: payload?.provenance || null,
        provenance: existing.provenance || null
      }
    };
  }
  return sarif;
};
