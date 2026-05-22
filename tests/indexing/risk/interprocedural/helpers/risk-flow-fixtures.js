import { computeInterproceduralRisk } from '../../../../../src/index/risk-interprocedural/engine.js';
import { buildRiskSummaries } from '../../../../../src/index/risk-interprocedural/summaries.js';

const DEFAULT_CAPS = Object.freeze({
  maxDepth: 4,
  maxPathsPerPair: 3,
  maxTotalFlows: 100,
  maxCallSitesPerEdge: 2,
  maxEdgeExpansions: 100,
  maxMs: null
});

const createRiskRecord = ({
  id,
  name,
  ruleType,
  category,
  severity,
  confidence,
  tags,
  excerpt
}) => ({
  id,
  name,
  ruleType,
  category,
  severity,
  confidence,
  tags,
  evidence: { line: 1, column: 1, excerpt }
});

export const createRiskSourceChunk = ({
  callArgs = ['req.body'],
  callLine = 5,
  callee = 'sink',
  targetChunkUid = 'uid-sink'
} = {}) => ({
  file: 'src/source.js',
  chunkUid: 'uid-source',
  name: 'source',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [
        createRiskRecord({
          id: 'source.req.body',
          name: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: 'low',
          confidence: 0.6,
          tags: ['input'],
          excerpt: 'req.body'
        })
      ],
      sinks: [],
      sanitizers: [],
      flows: []
    }
  },
  codeRelations: {
    callDetails: [
      {
        callee,
        calleeRaw: callee,
        calleeNormalized: callee,
        startLine: callLine,
        startCol: 1,
        endLine: callLine,
        endCol: 10,
        args: callArgs,
        targetChunkUid
      }
    ]
  }
});

export const createRiskSanitizerChunk = () => ({
  file: 'src/sanitize.js',
  chunkUid: 'uid-sanitize',
  name: 'sanitize',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [],
      sinks: [],
      sanitizers: [
        createRiskRecord({
          id: 'sanitize.escape',
          name: 'escape',
          ruleType: 'sanitizer',
          category: 'sanitize',
          severity: null,
          confidence: 0.4,
          tags: ['sanitize'],
          excerpt: 'escape'
        })
      ],
      flows: []
    }
  },
  codeRelations: {
    callDetails: [
      {
        callee: 'sink',
        calleeRaw: 'sink',
        calleeNormalized: 'sink',
        startLine: 5,
        startCol: 1,
        endLine: 5,
        endCol: 8,
        args: ['value'],
        targetChunkUid: 'uid-sink'
      }
    ]
  }
});

export const createRiskSinkChunk = () => ({
  file: 'src/sink.js',
  chunkUid: 'uid-sink',
  name: 'sink',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [],
      sinks: [
        createRiskRecord({
          id: 'sink.eval',
          name: 'eval',
          ruleType: 'sink',
          category: 'code-exec',
          severity: 'high',
          confidence: 0.8,
          tags: ['exec'],
          excerpt: 'eval'
        })
      ],
      sanitizers: [],
      flows: []
    }
  }
});

export const createRiskRuntime = ({
  caps = null,
  strictness = 'conservative',
  sanitizerPolicy = 'terminate',
  sourceRules = []
} = {}) => ({
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness,
    sanitizerPolicy,
    emitArtifacts: 'jsonl',
    caps: {
      ...DEFAULT_CAPS,
      ...(caps || {})
    }
  },
  riskInterproceduralEnabled: true,
  riskConfig: {
    rules: {
      sources: sourceRules
    }
  }
});

export const computeRiskScenario = ({
  chunks,
  runtime,
  mode = 'code',
  nowStepMs = null
}) => {
  const { rows } = buildRiskSummaries({
    chunks,
    runtime,
    mode
  });
  const originalNow = Date.now;
  if (Number.isFinite(nowStepMs)) {
    let tick = 0;
    Date.now = () => {
      tick += nowStepMs;
      return tick;
    };
  }
  try {
    return computeInterproceduralRisk({
      chunks,
      summaries: rows,
      runtime
    });
  } finally {
    Date.now = originalNow;
  }
};
