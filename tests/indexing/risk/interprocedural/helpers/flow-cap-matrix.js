import { buildRiskSummaries } from '../../../../../src/index/risk-interprocedural/summaries.js';
import { computeInterproceduralRisk } from '../../../../../src/index/risk-interprocedural/engine.js';

const sourceChunk = {
  file: 'src/source.js',
  chunkUid: 'uid-source',
  name: 'source',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [
        {
          id: 'source.req.body',
          name: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: 'low',
          confidence: 0.6,
          tags: ['input'],
          evidence: { line: 1, column: 1, excerpt: 'req.body' }
        }
      ],
      sinks: [],
      sanitizers: [],
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
        endCol: 10,
        args: ['req.body'],
        targetChunkUid: 'uid-sink'
      }
    ]
  }
};

const sinkChunk = {
  file: 'src/sink.js',
  chunkUid: 'uid-sink',
  name: 'sink',
  kind: 'Function',
  startLine: 1,
  docmeta: {
    risk: {
      sources: [],
      sinks: [
        {
          id: 'sink.eval',
          name: 'eval',
          ruleType: 'sink',
          category: 'code-exec',
          severity: 'high',
          confidence: 0.8,
          tags: ['exec'],
          evidence: { line: 2, column: 1, excerpt: 'eval' }
        }
      ],
      sanitizers: [],
      flows: []
    }
  }
};

const createRuntime = (caps) => ({
  riskInterproceduralConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 3,
      maxTotalFlows: 100,
      maxCallSitesPerEdge: 2,
      maxEdgeExpansions: 100,
      maxMs: null,
      ...(caps || {})
    }
  },
  riskInterproceduralEnabled: true,
  riskConfig: { rules: { sources: [] } }
});

const CHUNKS = [sourceChunk, sinkChunk];

export const runFlowCapScenario = ({
  caps = null,
  nowStepMs = null
} = {}) => {
  const runtime = createRuntime(caps);
  const { rows } = buildRiskSummaries({
    chunks: CHUNKS,
    runtime,
    mode: 'code'
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
      chunks: CHUNKS,
      summaries: rows,
      runtime
    });
  } finally {
    Date.now = originalNow;
  }
};
