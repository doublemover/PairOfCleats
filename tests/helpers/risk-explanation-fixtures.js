export const RISK_TEST_SEMANTIC_ID = 'sem.callback.register-handler-payload';

export const createRiskWatchStep = ({
  includeSemantics = true,
  ...overrides
} = {}) => {
  const step = {
    taintIn: ['req.body'],
    taintOut: ['input'],
    propagatedArgIndices: [0],
    boundParams: ['input'],
    calleeNormalized: 'query',
    sanitizerPolicy: 'terminate',
    sanitizerBarrierApplied: false,
    sanitizerBarriersBefore: 0,
    sanitizerBarriersAfter: 0,
    confidenceBefore: 0.6,
    confidenceAfter: 0.51,
    confidenceDelta: -0.09
  };
  if (includeSemantics) {
    step.semanticIds = [RISK_TEST_SEMANTIC_ID];
    step.semanticKinds = ['callback'];
  }
  return { ...step, ...overrides };
};

export const createRiskCallSiteDetails = (overrides = {}) => ({
  file: 'src/full.js',
  startLine: 18,
  startCol: 4,
  calleeNormalized: 'query',
  args: ['req.body'],
  excerpt: 'query(req.body)',
  ...overrides
});

export const createRiskCallSiteEvidence = ({
  callSiteId = 'cs-1',
  details = createRiskCallSiteDetails()
} = {}) => ({
  callSiteId,
  details
});

export const createRiskFlow = ({
  flowId = 'flow-full',
  confidence = 0.91,
  category = 'injection',
  source = { ruleId: 'SRC', ruleRole: 'source', tags: ['input', 'http'] },
  sink = { ruleId: 'SNK', ruleRole: 'sink', severity: 'high', tags: ['sql'] },
  path = null,
  evidence = null,
  includeLegacyCallSites = true
} = {}) => {
  const resolvedPath = path ?? {
    labels: ['chunk:src', 'chunk:sink'],
    nodes: [
      { type: 'chunk', chunkUid: 'chunk-full' },
      { type: 'chunk', chunkUid: 'chunk-sink' }
    ],
    callSiteIdsByStep: [['cs-1']],
    watchByStep: [createRiskWatchStep()]
  };
  const resolvedEvidence = evidence ?? {
    callSitesByStep: [[createRiskCallSiteEvidence()]]
  };
  const flow = {
    flowId,
    confidence,
    category,
    source,
    sink,
    path: resolvedPath,
    evidence: resolvedEvidence
  };
  if (includeLegacyCallSites) {
    flow.callSitesByStep = resolvedEvidence.callSitesByStep;
  }
  return flow;
};

export const createRiskPartialFlow = ({
  partialFlowId = 'partial-a',
  confidence = 0.72,
  source = { ruleId: 'SRC', chunkUid: 'chunk-full' },
  frontier = null,
  path = null,
  evidence = null,
  notes = null
} = {}) => ({
  partialFlowId,
  confidence,
  source,
  frontier: frontier ?? {
    chunkUid: 'chunk-mid',
    terminalReason: 'maxDepth',
    blockedExpansions: [{
      reason: 'maxEdgeExpansions',
      targetChunkUid: 'chunk-sink',
      callSiteIds: ['cs-1']
    }]
  },
  path: path ?? {
    labels: ['chunk:src', 'chunk:mid'],
    nodes: [
      { type: 'chunk', chunkUid: 'chunk-full' },
      { type: 'chunk', chunkUid: 'chunk-mid' }
    ],
    callSiteIdsByStep: [['cs-1']],
    watchByStep: [createRiskWatchStep()]
  },
  evidence: evidence ?? {
    callSitesByStep: [[createRiskCallSiteEvidence()]]
  },
  notes: notes ?? {
    hopCount: 1,
    terminalReason: 'maxDepth',
    capsHit: ['maxDepth']
  }
});

export const createRiskSummary = (overrides = {}) => ({
  chunkUid: 'chunk-full',
  file: 'src/full.js',
  symbol: {
    name: 'full',
    kind: 'function'
  },
  totals: {
    sources: 1,
    sinks: 1,
    sanitizers: 0,
    localFlows: 1
  },
  ruleRoles: {
    sources: 1,
    sinks: 1,
    sanitizers: 0
  },
  propagatorLikeRoles: [{ role: 'callback', count: 1 }],
  topCategories: [{ category: 'injection', count: 1 }],
  topTags: [{ tag: 'sql', count: 1 }],
  ...overrides
});

export const createRiskProvenance = (overrides = {}) => ({
  generatedAt: '2026-03-12T00:00:00.000Z',
  ruleBundle: {
    version: '1.0.0',
    fingerprint: 'sha1:bundle',
    roleModel: {
      version: '1.0.0',
      directRoles: ['source', 'sink', 'sanitizer'],
      propagatorLikeRoles: ['propagator', 'wrapper', 'builder', 'callback', 'asyncHandoff'],
      propagatorLikeEncoding: 'watch-semantics'
    }
  },
  effectiveConfigFingerprint: 'sha1:config',
  artifactRefs: {
    flows: { entrypoint: 'risk_flows.jsonl' }
  },
  ...overrides
});

export const createMinimalRiskStandaloneInput = () => ({
  chunk: { chunkUid: 'chunk-min', file: 'src/min.js', name: 'minimal', kind: 'function' },
  summary: {
    totals: { sources: 0, sinks: 0, sanitizers: 0, localFlows: 0 },
    topCategories: [],
    topTags: []
  },
  stats: {
    status: 'ok',
    flowsEmitted: 0,
    summariesEmitted: 1,
    uniqueCallSitesReferenced: 0,
    capsHit: []
  },
  flows: []
});

export const createFullRiskSliceInput = () => ({
  summary: createRiskSummary(),
  stats: {
    status: 'ok',
    flowsEmitted: 1,
    partialFlowsEmitted: 2,
    summariesEmitted: 1,
    uniqueCallSitesReferenced: 1,
    capsHit: []
  },
  analysisStatus: { status: 'ok', code: 'ok' },
  caps: {
    maxFlows: 3,
    maxPartialFlows: 5,
    maxBytes: 512,
    maxTokens: 128,
    maxPartialBytes: 100,
    maxPartialTokens: 50,
    hits: []
  },
  provenance: createRiskProvenance(),
  flows: [createRiskFlow()],
  partialFlows: [createRiskPartialFlow()]
});

export const createFullRiskStandaloneInput = () => ({
  chunk: { chunkUid: 'chunk-full', file: 'src/full.js', name: 'full', kind: 'function' },
  provenance: createRiskProvenance({
    ruleBundle: { version: '1.0.0', fingerprint: 'sha1:bundle' },
    artifactRefs: undefined
  }),
  partialFlows: [createRiskPartialFlow()],
  flows: [createRiskFlow()]
});

export const createCappedRiskSliceInput = () => ({
  summary: {
    totals: { sources: 2, sinks: 2, sanitizers: 0, localFlows: 2 },
    topCategories: [{ category: 'injection', count: 2 }],
    topTags: []
  },
  truncation: [{ cap: 'maxFlows', limit: 1, observed: 2, omitted: 1 }],
  flows: [
    {
      flowId: 'flow-a',
      confidence: 0.7,
      category: 'injection',
      source: { ruleId: 'SRC-A' },
      sink: { ruleId: 'SNK-A' },
      path: { labels: ['chunk:a', 'chunk:b'] },
      evidence: { callSitesByStep: [[{ callSiteId: 'cs-a' }]] }
    },
    {
      flowId: 'flow-b',
      confidence: 0.6,
      category: 'injection',
      source: { ruleId: 'SRC-B' },
      sink: { ruleId: 'SNK-B' },
      path: { labels: ['chunk:b', 'chunk:c'] },
      evidence: { callSitesByStep: [[{ callSiteId: 'cs-b' }]] }
    }
  ]
});
