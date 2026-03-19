#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../src/shared/json-stream.js';
import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import { CONTEXT_PACK_RISK_CONTRACT_VERSION } from '../../src/contracts/context-pack-risk-contract.js';
import { renderCompositeContextPack, renderCompositeContextPackJson } from '../../src/retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'context-pack-risk-assembly');
const repoRoot = path.join(tempRoot, 'repo');
const repoFile = path.join(repoRoot, 'src', 'file.js');
const repoTestFile = path.join(repoRoot, 'tests', 'risky.test.js');
const repoTestFileB = path.join(repoRoot, 'tests', 'risky-b.test.js');
const repoTestFileC = path.join(repoRoot, 'tests', 'risky-c.test.js');
const repoTestFileD = path.join(repoRoot, 'tests', 'risky-d.test.js');
const fixedNow = () => '2026-03-12T00:00:00.000Z';
const repoSourceText = 'export function risky(input) {\n  return query(input);\n}\n';
const queryExcerptText = 'query(input)';
const queryOffset = repoSourceText.indexOf(queryExcerptText);

const summaryRow = {
  schemaVersion: 1,
  chunkUid: 'chunk-risk',
  file: 'src/file.js',
  languageId: 'javascript',
  symbol: {
    name: 'risky',
    kind: 'FunctionDeclaration',
    signature: 'risky(input)'
  },
  signals: {
    sources: [{
      ruleId: 'source.req.body',
      ruleName: 'req.body',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.6,
      tags: ['a', 'b'],
      evidence: []
    }],
    sinks: [{
      ruleId: 'sink.sql.query',
      ruleName: 'sql.query',
      ruleType: 'sink',
      category: 'logging',
      severity: 'high',
      confidence: 0.9,
      tags: ['b'],
      evidence: []
    }],
    sanitizers: [],
    localFlows: []
  },
  totals: {
    sources: 1,
    sinks: 1,
    sanitizers: 0,
    localFlows: 0
  },
  truncated: {
    sources: false,
    sinks: false,
    sanitizers: false,
    localFlows: false,
    evidence: false
  }
};

const flowRow = {
  schemaVersion: 1,
  flowId: 'sha1:1111111111111111111111111111111111111111',
  source: {
    chunkUid: 'chunk-risk',
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    category: 'input',
    severity: 'low',
    confidence: 0.6,
    tags: ['input', 'request']
  },
  sink: {
    chunkUid: 'chunk-risk-sink',
    ruleId: 'sink.sql.query',
    ruleName: 'sql.query',
    ruleType: 'sink',
    category: 'injection',
    severity: 'high',
    confidence: 0.9,
    tags: ['sql', 'exec']
  },
  path: {
    chunkUids: ['chunk-risk', 'chunk-risk-sink'],
    callSiteIdsByStep: [['cs-1']],
    watchByStep: [{
      taintIn: ['req.body'],
      taintOut: ['input'],
      propagatedArgIndices: [0],
      boundParams: ['input'],
      calleeNormalized: 'query',
      semanticIds: ['sem.callback.register-handler-payload'],
      semanticKinds: ['callback'],
      sanitizerPolicy: 'terminate',
      sanitizerBarrierApplied: false,
      sanitizerBarriersBefore: 0,
      sanitizerBarriersAfter: 0,
      confidenceBefore: 0.6,
      confidenceAfter: 0.51,
      confidenceDelta: -0.09
    }]
  },
  confidence: 0.88,
  notes: {
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    hopCount: 1,
    sanitizerBarriersHit: 0,
    capsHit: []
  }
};

const partialFlowRow = {
  schemaVersion: 1,
  partialFlowId: 'sha1:5555555555555555555555555555555555555555',
  source: {
    chunkUid: 'chunk-risk',
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    category: 'input',
    severity: 'low',
    confidence: 0.6,
    tags: ['input', 'request']
  },
  frontier: {
    chunkUid: 'chunk-risk-sink',
    terminalReason: 'maxDepth',
    blockedExpansions: [
      {
        targetChunkUid: 'chunk-risk-sink',
        reason: 'maxEdgeExpansions',
        callSiteIds: ['cs-1']
      }
    ]
  },
  path: {
    chunkUids: ['chunk-risk', 'chunk-risk-sink'],
    callSiteIdsByStep: [['cs-1']],
    watchByStep: [{
      taintIn: ['req.body'],
      taintOut: ['input'],
      propagatedArgIndices: [0],
      boundParams: ['input'],
      calleeNormalized: 'query',
      semanticIds: ['sem.callback.register-handler-payload'],
      semanticKinds: ['callback'],
      sanitizerPolicy: 'terminate',
      sanitizerBarrierApplied: false,
      sanitizerBarriersBefore: 0,
      sanitizerBarriersAfter: 0,
      confidenceBefore: 0.6,
      confidenceAfter: 0.51,
      confidenceDelta: -0.09
    }]
  },
  confidence: 0.64,
  notes: {
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    hopCount: 1,
    sanitizerBarriersHit: 0,
    capsHit: ['maxDepth'],
    terminalReason: 'maxDepth'
  }
};

const callSiteRow = {
  callSiteId: 'cs-1',
  callerChunkUid: 'chunk-risk',
  file: 'src/file.js',
  languageId: 'javascript',
  start: queryOffset,
  end: queryOffset + queryExcerptText.length,
  startLine: 2,
  startCol: 10,
  endLine: 2,
  endCol: 22,
  calleeRaw: 'query',
  calleeNormalized: 'query',
  args: ['input']
};

const rankedPathOnlyFlow = {
  ...flowRow,
  flowId: 'sha1:2222222222222222222222222222222222222222',
  source: {
    ...flowRow.source,
    chunkUid: 'chunk-helper',
    severity: 'medium',
    confidence: 0.95
  },
  sink: {
    ...flowRow.sink,
    chunkUid: 'chunk-helper-sink',
    severity: 'low',
    confidence: 0.95
  },
  path: {
    chunkUids: ['chunk-helper', 'chunk-risk', 'chunk-helper-sink'],
    callSiteIdsByStep: [['cs-1']],
    watchByStep: [{
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
    }]
  },
  confidence: 0.95,
  notes: {
    ...flowRow.notes,
    hopCount: 3
  }
};

const truncatedEvidenceFlow = {
  ...flowRow,
  flowId: 'sha1:3333333333333333333333333333333333333333',
  path: {
    chunkUids: ['chunk-risk', 'chunk-mid-1', 'chunk-mid-2', 'chunk-mid-3', 'chunk-mid-4', 'chunk-mid-5', 'chunk-mid-6', 'chunk-mid-7', 'chunk-risk-sink'],
    callSiteIdsByStep: [
      ['cs-1', 'cs-2', 'cs-3', 'cs-4'],
      ['cs-5'],
      ['cs-6'],
      ['cs-7'],
      ['cs-8'],
      ['cs-9'],
      ['cs-10'],
      ['cs-11'],
      ['cs-12']
    ],
    watchByStep: Array.from({ length: 9 }, (_, index) => ({
      taintIn: ['req.body'],
      taintOut: ['value'],
      propagatedArgIndices: [0],
      boundParams: ['value'],
      calleeNormalized: `callee-${index + 1}`,
      sanitizerPolicy: 'terminate',
      sanitizerBarrierApplied: false,
      sanitizerBarriersBefore: 0,
      sanitizerBarriersAfter: 0,
      confidenceBefore: 0.6,
      confidenceAfter: 0.51,
      confidenceDelta: -0.09
    }))
  },
  confidence: 0.87,
  notes: {
    ...flowRow.notes,
    hopCount: 9
  }
};

const oversizedBudgetFlow = {
  ...flowRow,
  flowId: 'sha1:4444444444444444444444444444444444444444',
  source: {
    ...flowRow.source,
    ruleName: 'x'.repeat(30000)
  },
  confidence: 0.99,
  notes: {
    ...flowRow.notes,
    hopCount: 1
  }
};

const extraCallSiteRows = Array.from({ length: 12 }, (_, index) => ({
  ...callSiteRow,
  callSiteId: `cs-${index + 1}`,
  startLine: index + 1,
  endLine: index + 1,
  calleeRaw: `callee-${index + 1}`,
  calleeNormalized: `callee-${index + 1}`,
  args: [`arg-${index + 1}`]
}));

const baseStats = {
  schemaVersion: 1,
  generatedAt: '2026-03-12T00:00:00.000Z',
  mode: 'code',
  status: 'ok',
  reason: null,
  effectiveConfig: {
    enabled: true,
    summaryOnly: false,
    emitArtifacts: 'jsonl'
  },
  counts: {
    flowsEmitted: 1,
    uniqueCallSitesReferenced: 1
  },
  callSiteSampling: {
    strategy: 'firstN',
    maxCallSitesPerEdge: 1,
    order: 'deterministic'
  },
  capsHit: [],
  timingMs: {
    summaries: 1,
    propagation: 2,
    io: 1,
    total: 4
  },
  provenance: {
    indexSignature: 'sig-risk-assembly',
    indexCompatKey: 'compat-test',
    ruleBundle: {
      version: '1.0.0',
      fingerprint: 'sha1:rulebundle-risk-assembly',
      provenance: {
        defaults: true,
        sourcePath: null
      }
    },
    effectiveConfigFingerprint: 'sha1:config-risk-assembly'
  },
  artifacts: {
    stats: {
      name: 'risk_interprocedural_stats',
      format: 'json',
      sharded: false,
      entrypoint: 'risk_interprocedural_stats.json',
      totalEntries: 1
    },
    riskSummaries: {
      name: 'risk_summaries',
      format: 'jsonl',
      sharded: false,
      entrypoint: 'risk_summaries.jsonl',
      totalEntries: 1
    },
    riskFlows: {
      name: 'risk_flows',
      format: 'jsonl',
      sharded: false,
      entrypoint: 'risk_flows.jsonl',
      totalEntries: 1
    },
    callSites: {
      name: 'call_sites',
      format: 'jsonl',
      sharded: false,
      entrypoint: 'call_sites.jsonl',
      totalEntries: 1
    }
  }
};

const chunkMeta = [
  {
    id: 0,
    file: 'src/file.js',
    chunkUid: 'chunk-risk',
    start: 0,
    end: 48,
    startLine: 1,
    endLine: 3
  }
];

const frameworkChunkMeta = structuredClone(chunkMeta);
frameworkChunkMeta[0].lang = 'javascript';
frameworkChunkMeta[0].docmeta = {
  ...frameworkChunkMeta[0].docmeta,
  frameworkProfile: {
    id: 'react',
    confidence: 'heuristic',
    signals: {
      reactHydrationBoundary: true
    }
  }
};

const partialLanguageChunkMeta = structuredClone(chunkMeta);
partialLanguageChunkMeta[0].lang = 'cmake';
partialLanguageChunkMeta[0].docmeta = {
  ...partialLanguageChunkMeta[0].docmeta,
  usrCapabilities: {
    state: 'partial',
    source: 'cmake',
    diagnostics: [
      {
        code: 'USR-W-CAPABILITY-DOWNGRADED',
        reasonCode: 'imports-only',
        detail: 'Heuristic adapter only supports import and symbol heuristics.'
      }
    ]
  }
};

const unsupportedLanguageChunkMeta = structuredClone(chunkMeta);
unsupportedLanguageChunkMeta[0].lang = 'unknownlang';

const partialLanguageSummaryRow = {
  ...summaryRow,
  languageId: 'cmake'
};

const unsupportedLanguageSummaryRow = {
  ...summaryRow,
  languageId: 'unknownlang'
};

const graphIndex = {
  graphRelations: {
    importGraph: {
      nodeCount: 2,
      edgeCount: 1,
      nodes: [
        { id: 'tests/risky.test.js', file: 'tests/risky.test.js', out: ['src/file.js'], in: [] },
        { id: 'src/file.js', file: 'src/file.js', out: [], in: ['tests/risky.test.js'] }
      ]
    }
  },
  callGraphIndex: new Map([
    ['chunk-risk', { id: 'chunk-risk', file: 'src/file.js', name: 'risky', kind: 'function', in: ['chunk-caller'], out: ['chunk-risk-sink'] }],
    ['chunk-risk-sink', { id: 'chunk-risk-sink', file: 'src/db.js', name: 'query', kind: 'function', in: ['chunk-caller'], out: [] }],
    ['chunk-caller', { id: 'chunk-caller', file: 'src/controller.js', name: 'controller', kind: 'function', in: [], out: ['chunk-risk'] }]
  ]),
  symbolIndex: {
    byChunk: new Map([
      ['chunk-risk', [{
        symbolId: 'sym:risky',
        toRef: {
          status: 'resolved',
          resolved: {
            symbolId: 'sym:risky',
            chunkUid: 'chunk-risk',
            path: 'src/file.js',
            name: 'risky',
            kind: 'function'
          },
          candidates: []
        }
      }]],
      ['chunk-risk-sink', [{
        symbolId: 'sym:query',
        toRef: {
          status: 'resolved',
          resolved: {
            symbolId: 'sym:query',
            chunkUid: 'chunk-risk-sink',
            path: 'src/db.js',
            name: 'query',
            kind: 'function'
          },
          candidates: []
        }
      }]]
    ])
  }
};

const cappedGraphIndex = {
  graphRelations: {
    importGraph: {
      nodeCount: 5,
      edgeCount: 4,
      nodes: [
        { id: 'tests/risky.test.js', file: 'tests/risky.test.js', out: ['src/file.js'], in: [] },
        { id: 'tests/risky-b.test.js', file: 'tests/risky-b.test.js', out: ['src/file.js'], in: [] },
        { id: 'tests/risky-c.test.js', file: 'tests/risky-c.test.js', out: ['src/file.js'], in: [] },
        { id: 'tests/risky-d.test.js', file: 'tests/risky-d.test.js', out: ['src/file.js'], in: [] },
        { id: 'src/file.js', file: 'src/file.js', out: [], in: ['tests/risky.test.js', 'tests/risky-b.test.js', 'tests/risky-c.test.js', 'tests/risky-d.test.js'] }
      ]
    }
  },
  callGraphIndex: new Map([
    ['chunk-risk', { id: 'chunk-risk', file: 'src/file.js', name: 'risky', kind: 'function', in: ['chunk-caller-a', 'chunk-caller-b', 'chunk-caller-c', 'chunk-caller-d'], out: ['chunk-risk-sink'] }],
    ['chunk-risk-sink', { id: 'chunk-risk-sink', file: 'src/db.js', name: 'query', kind: 'function', in: ['chunk-caller-a', 'chunk-caller-b'], out: [] }],
    ['chunk-caller-a', { id: 'chunk-caller-a', file: 'src/controller-a.js', name: 'controllerA', kind: 'function', in: [], out: ['chunk-risk'] }],
    ['chunk-caller-b', { id: 'chunk-caller-b', file: 'src/controller-b.js', name: 'controllerB', kind: 'function', in: [], out: ['chunk-risk'] }],
    ['chunk-caller-c', { id: 'chunk-caller-c', file: 'src/controller-c.js', name: 'controllerC', kind: 'function', in: [], out: ['chunk-risk'] }],
    ['chunk-caller-d', { id: 'chunk-caller-d', file: 'src/controller-d.js', name: 'controllerD', kind: 'function', in: [], out: ['chunk-risk'] }]
  ]),
  symbolIndex: {
    byChunk: new Map([
      ['chunk-risk', [
        {
          symbolId: 'sym:risky',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:risky', chunkUid: 'chunk-risk', path: 'src/file.js', name: 'risky', kind: 'function' },
            candidates: []
          }
        },
        {
          symbolId: 'sym:risky-helper-a',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:risky-helper-a', chunkUid: 'chunk-risk', path: 'src/file.js', name: 'riskyHelperA', kind: 'function' },
            candidates: []
          }
        },
        {
          symbolId: 'sym:risky-helper-b',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:risky-helper-b', chunkUid: 'chunk-risk', path: 'src/file.js', name: 'riskyHelperB', kind: 'function' },
            candidates: []
          }
        }
      ]],
      ['chunk-risk-sink', [
        {
          symbolId: 'sym:query',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:query', chunkUid: 'chunk-risk-sink', path: 'src/db.js', name: 'query', kind: 'function' },
            candidates: []
          }
        },
        {
          symbolId: 'sym:query-unsafe',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:query-unsafe', chunkUid: 'chunk-risk-sink', path: 'src/db.js', name: 'queryUnsafe', kind: 'function' },
            candidates: []
          }
        },
        {
          symbolId: 'sym:query-builder',
          toRef: {
            status: 'resolved',
            resolved: { symbolId: 'sym:query-builder', chunkUid: 'chunk-risk-sink', path: 'src/db.js', name: 'queryBuilder', kind: 'function' },
            candidates: []
          }
        }
      ]]
    ])
  }
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(repoRoot, 'tests'), { recursive: true });
await fs.writeFile(repoFile, repoSourceText, 'utf8');
await fs.writeFile(repoTestFile, 'test(\'risky\', () => {});\n', 'utf8');
await fs.writeFile(repoTestFileB, 'test(\'risky b\', () => {});\n', 'utf8');
await fs.writeFile(repoTestFileC, 'test(\'risky c\', () => {});\n', 'utf8');
await fs.writeFile(repoTestFileD, 'test(\'risky d\', () => {});\n', 'utf8');

const writeJsonl = async (filePath, rows) => {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
};

const writeManifest = async (indexDir, pieces) => {
  await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
  await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
    fields: {
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: 'compat-test',
      generatedAt: fixedNow(),
      mode: 'code',
      stage: 'context-pack-risk',
      pieces
    }
  });
};

const buildPack = async ({
  name,
  stats = null,
  summaries = null,
  flows = null,
  partialFlows = null,
  callSites = null,
  riskFilters = null,
  includeRiskPartialFlows = false,
  includeGraph = false,
  includeCallersCallees = false,
  graphIndexOverride = null,
  chunkMetaOverride = chunkMeta
}) => {
  const indexDir = path.join(tempRoot, name, 'index-code');
  await fs.rm(indexDir, { recursive: true, force: true });
  await fs.mkdir(indexDir, { recursive: true });
  const pieces = [];
  if (stats) {
    await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), { fields: stats });
    pieces.push({ name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' });
  }
  if (summaries) {
    await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), summaries);
    pieces.push({ name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' });
  }
  if (flows) {
    await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
    pieces.push({ name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' });
  }
  if (partialFlows) {
    await writeJsonl(path.join(indexDir, 'risk_partial_flows.jsonl'), partialFlows);
    pieces.push({ name: 'risk_partial_flows', path: 'risk_partial_flows.jsonl', format: 'jsonl' });
  }
  if (callSites) {
    await writeJsonl(path.join(indexDir, 'call_sites.jsonl'), callSites);
    pieces.push({ name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' });
  }
  await writeManifest(indexDir, pieces);
  return assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-risk' },
    chunkMeta: chunkMetaOverride,
    repoRoot,
    indexDir,
    graphIndex: graphIndexOverride,
    indexCompatKey: 'compat-test',
    now: fixedNow,
    includeGraph,
    includeTypes: false,
    includeRisk: true,
    includeRiskPartialFlows,
    riskFilters,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees
  });
};

const fullPack = await buildPack({
  name: 'full',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow],
  includeGraph: true,
  includeCallersCallees: true,
  graphIndexOverride: graphIndex
});
assert.equal(fullPack.risk?.status, 'ok');
assert.equal(fullPack.risk?.version, 1);
assert.equal(fullPack.risk?.contractVersion, CONTEXT_PACK_RISK_CONTRACT_VERSION);
assert.equal(fullPack.risk?.summary?.chunkUid, 'chunk-risk');
assert.deepEqual(
  fullPack.risk?.analysisStatus?.artifactStatus,
  {
    stats: 'present',
    summaries: 'present',
    flows: 'present',
    partialFlows: 'not_required',
    callSites: 'present'
  }
);
assert.equal(fullPack.risk?.provenance?.compatibilityKey, 'compat-test');
assert.equal(fullPack.risk?.provenance?.indexSignature, 'sig-risk-assembly');
assert.equal(fullPack.risk?.provenance?.indexCompatKey, 'compat-test');
assert.equal(fullPack.risk?.provenance?.ruleBundle?.version, '1.0.0');
assert.equal(fullPack.risk?.provenance?.ruleBundle?.fingerprint, 'sha1:rulebundle-risk-assembly');
assert.equal(fullPack.risk?.provenance?.ruleBundle?.roleModel?.version, '1.0.0');
assert.deepEqual(fullPack.risk?.provenance?.ruleBundle?.roleModel?.directRoles, ['source', 'sink', 'sanitizer']);
assert.equal(fullPack.risk?.provenance?.ruleBundle?.roleModel?.propagatorLikeEncoding, 'watch-semantics');
assert.equal(fullPack.risk?.provenance?.effectiveConfigFingerprint, 'sha1:config-risk-assembly');
assert.equal(fullPack.risk?.provenance?.artifactRefs?.stats?.entrypoint, 'risk_interprocedural_stats.json');
assert.equal(fullPack.risk?.provenance?.artifactRefs?.summaries?.entrypoint, 'risk_summaries.jsonl');
assert.equal(fullPack.risk?.provenance?.artifactRefs?.flows?.entrypoint, 'risk_flows.jsonl');
assert.equal(fullPack.risk?.provenance?.artifactRefs?.partialFlows, null);
assert.equal(fullPack.risk?.provenance?.artifactRefs?.callSites?.entrypoint, 'call_sites.jsonl');
assert.equal(fullPack.risk?.caps?.maxFlows, 5);
assert.equal(fullPack.risk?.caps?.maxCallSitesPerStep, 3);
assert.equal(fullPack.risk?.flows?.length, 1);
assert.equal(fullPack.risk?.flows?.[0]?.source?.ruleId, 'source.req.body');
assert.equal(fullPack.risk?.flows?.[0]?.source?.ruleRole, 'source');
assert.deepEqual(fullPack.risk?.flows?.[0]?.source?.tags, ['input', 'request']);
assert.equal(fullPack.risk?.flows?.[0]?.sink?.ruleId, 'sink.sql.query');
assert.equal(fullPack.risk?.flows?.[0]?.sink?.ruleRole, 'sink');
assert.deepEqual(fullPack.risk?.flows?.[0]?.sink?.tags, ['sql', 'exec']);
assert.equal(fullPack.risk?.flows?.[0]?.notes?.hopCount, 1);
assert.equal(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.callSiteId, 'cs-1');
assert.equal(fullPack.risk?.flows?.[0]?.path?.watchByStep?.[0]?.calleeNormalized, 'query');
assert.deepEqual(fullPack.risk?.flows?.[0]?.path?.watchByStep?.[0]?.boundParams, ['input']);
assert.deepEqual(fullPack.risk?.flows?.[0]?.path?.watchByStep?.[0]?.semanticIds, ['sem.callback.register-handler-payload']);
assert.deepEqual(fullPack.risk?.flows?.[0]?.path?.watchByStep?.[0]?.semanticKinds, ['callback']);
assert.equal(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.excerpt, 'query(input)');
assert.match(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.excerptHash || '', /^sha1:/);
assert.equal(fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.provenance?.excerptSource, 'repo-range');
assert.equal(fullPack.risk?.guidance?.callers?.[0]?.chunkUid, 'chunk-caller');
assert.equal(fullPack.risk?.guidance?.symbols?.[0]?.symbolId, 'sym:query');
assert.equal(fullPack.risk?.guidance?.tests?.[0]?.testPath, 'tests/risky.test.js');
assert.match(fullPack.risk?.guidance?.ranking?.callers || '', /Direct inbound callers/i);
assert.deepEqual(fullPack.risk?.guidance?.caps?.hits || [], []);
assert.equal(fullPack.risk?.support?.language?.languageId, 'javascript');
assert.equal(fullPack.risk?.support?.language?.state, 'supported');
assert.equal(fullPack.risk?.support?.language?.capabilities?.riskLocal, 'supported');
assert.equal(fullPack.risk?.support?.language?.capabilities?.riskInterprocedural, 'partial');
assert.ok(
  fullPack.risk?.support?.downgradedReasoningPaths?.some((entry) => entry?.code === 'risk_interprocedural_partial'),
  'expected supported language to surface interprocedural downgrade reasoning'
);
const frameworkPack = await buildPack({
  name: 'risk-ok-framework-support',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow],
  chunkMetaOverride: frameworkChunkMeta
});
assert.equal(frameworkPack.risk?.support?.framework?.frameworkId, 'react');
assert.equal(frameworkPack.risk?.support?.framework?.state, 'partial');
assert.ok(
  frameworkPack.risk?.support?.downgradedReasoningPaths?.some((entry) => entry?.code === 'RISK_FRAMEWORK_BASELINE_ONLY'),
  'expected framework baseline-only downgrade path'
);
const partialSupportPack = await buildPack({
  name: 'risk-ok-language-partial',
  stats: baseStats,
  summaries: [partialLanguageSummaryRow],
  flows: [flowRow],
  callSites: [callSiteRow],
  chunkMetaOverride: partialLanguageChunkMeta
});
assert.equal(partialSupportPack.risk?.support?.language?.languageId, 'cmake');
assert.equal(partialSupportPack.risk?.support?.language?.state, 'partial');
assert.deepEqual(partialSupportPack.risk?.support?.language?.unsupportedConstructs?.sources, ['interprocedural-source']);
assert.ok(
  partialSupportPack.risk?.support?.downgradedReasoningPaths?.some((entry) => entry?.code === 'USR-W-CAPABILITY-DOWNGRADED'),
  'expected partial language diagnostics to surface as downgraded reasoning'
);
const unsupportedSupportPack = await buildPack({
  name: 'risk-ok-language-unsupported',
  stats: baseStats,
  summaries: [unsupportedLanguageSummaryRow],
  flows: [flowRow],
  callSites: [callSiteRow],
  chunkMetaOverride: unsupportedLanguageChunkMeta
});
assert.equal(unsupportedSupportPack.risk?.support?.language?.languageId, 'unknownlang');
assert.equal(unsupportedSupportPack.risk?.support?.language?.state, 'unsupported');
assert.ok(
  unsupportedSupportPack.risk?.support?.language?.diagnostics?.some((entry) => entry?.code === 'RISK_LANGUAGE_PROFILE_MISSING'),
  'expected unsupported language to report missing registry profile'
);
const noGraphPack = await buildPack({
  name: 'risk-ok-no-graph',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow]
});
assert.equal(noGraphPack.risk?.guidance, null);
const guidanceCappedPack = await buildPack({
  name: 'risk-ok-guidance-capped',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow],
  includeGraph: true,
  includeCallersCallees: true,
  graphIndexOverride: cappedGraphIndex
});
assert.equal(guidanceCappedPack.risk?.guidance?.callers?.length, 3);
assert.equal(guidanceCappedPack.risk?.guidance?.symbols?.length, 5);
assert.equal(guidanceCappedPack.risk?.guidance?.tests?.length, 3);
assert.deepEqual(guidanceCappedPack.risk?.guidance?.caps?.hits, ['maxCallers', 'maxSymbols', 'maxTests']);
assert.deepEqual(
  fullPack.risk?.summary?.ruleRoles,
  {
    sources: 1,
    sinks: 1,
    sanitizers: 0
  }
);
assert.deepEqual(
  fullPack.risk?.summary?.propagatorLikeRoles,
  [
    { role: 'callback', count: 1 }
  ]
);
assert.deepEqual(
  fullPack.risk?.summary?.topCategories,
  [
    { category: 'input', count: 1 },
    { category: 'logging', count: 1 }
  ]
);
assert.deepEqual(
  fullPack.risk?.summary?.topTags,
  [
    { tag: 'b', count: 2 },
    { tag: 'a', count: 1 }
  ]
);
assert.deepEqual(fullPack.risk?.summary?.previewFlowIds, ['sha1:1111111111111111111111111111111111111111']);
assert.equal(validateCompositeContextPack(fullPack).ok, true, 'expected full risk slice to validate');
const fullRendered = renderCompositeContextPack(fullPack);
assert.ok(fullRendered.includes('status: ok'), 'expected rendered status');
assert.ok(fullRendered.includes('src/file.js:2:10 query(input)'), 'expected rendered risk evidence');
assert.ok(fullRendered.includes('top categories:'), 'expected rendered top categories');
assert.ok(fullRendered.includes('rules 1.0.0 sha1:rulebundle-risk-assembly'), 'expected rendered rule bundle provenance');
assert.ok(fullRendered.includes('artifact refs:'), 'expected rendered artifact refs');
assert.ok(fullRendered.includes('rules: source.req.body -> sink.sql.query'), 'expected rendered rules');
assert.ok(fullRendered.includes('semantics sem.callback.register-handler-payload'), 'expected rendered semantics labels');
const fullRenderedJson = renderCompositeContextPackJson(fullPack);
assert.equal(fullRenderedJson.rendered?.risk?.support?.language?.state, 'supported');
assert.equal(fullRenderedJson.rendered?.sarif?.runs?.[0]?.results?.[0]?.properties?.pairOfCleats?.flowId, flowRow.flowId);
assert.equal(
  fullRenderedJson.rendered?.sarif?.runs?.[0]?.results?.[0]?.codeFlows?.[0]?.threadFlows?.[0]?.locations?.[0]
    ?.location?.physicalLocation?.artifactLocation?.uri,
  'src/file.js'
);
const partialSupportRendered = renderCompositeContextPack(partialSupportPack);
assert.match(partialSupportRendered, /support: language cmake partial/i);
assert.match(partialSupportRendered, /unsupported constructs: sources interprocedural-source/i);

const fullPackRepeat = await buildPack({
  name: 'full-repeat',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [callSiteRow]
});
assert.equal(
  fullPackRepeat.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.excerptHash,
  fullPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.excerptHash,
  'expected hydrated call-site excerpt hash to stay stable across repeated assembly'
);

const summaryOnlyPack = await buildPack({
  name: 'summary-only',
  stats: {
    ...baseStats,
    effectiveConfig: { ...baseStats.effectiveConfig, summaryOnly: true },
    counts: { ...baseStats.counts, flowsEmitted: 0, partialFlowsEmitted: 0, uniqueCallSitesReferenced: 0 }
  },
  summaries: [summaryRow]
});
assert.equal(summaryOnlyPack.risk?.status, 'summary_only');
assert.equal(summaryOnlyPack.risk?.flows?.length, 0);
assert.equal(summaryOnlyPack.risk?.degraded, false);
assert.equal(summaryOnlyPack.risk?.analysisStatus?.summaryOnly, true);

const missingPack = await buildPack({
  name: 'missing'
});
assert.equal(missingPack.risk?.version, 1);
assert.equal(missingPack.risk?.status, 'missing');
assert.deepEqual(missingPack.risk?.filters, {
  rule: [],
  category: [],
  severity: [],
  tag: [],
  source: [],
  sink: [],
  sourceRule: [],
  sinkRule: [],
  flowId: []
});
assert.equal(missingPack.risk?.caps, null);
assert.deepEqual(missingPack.risk?.truncation, []);
assert.equal(typeof missingPack.risk?.provenance, 'object');
assert.deepEqual(
  missingPack.risk?.analysisStatus?.artifactStatus,
  {
    stats: 'missing',
    summaries: 'missing',
    flows: 'not_required',
    partialFlows: 'not_required',
    callSites: 'not_required'
  }
);
assert.ok(missingPack.warnings?.some((entry) => entry?.code === 'MISSING_RISK'), 'expected missing risk warning');

const degradedPack = await buildPack({
  name: 'degraded',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow]
});
assert.equal(degradedPack.risk?.status, 'degraded');
assert.equal(degradedPack.risk?.degraded, true);
assert.equal(degradedPack.risk?.analysisStatus?.artifactStatus?.callSites, 'missing');
assert.equal(degradedPack.risk?.analysisStatus?.artifactStatus?.partialFlows, 'not_required');
assert.ok(degradedPack.warnings?.some((entry) => entry?.code === 'RISK_CALL_SITES_MISSING'), 'expected degraded call-site warning');

const partialPack = await buildPack({
  name: 'partial',
  stats: {
    ...baseStats,
    counts: {
      ...baseStats.counts,
      partialFlowsEmitted: 1
    },
    artifacts: {
      ...baseStats.artifacts,
      partialFlows: {
        name: 'risk_partial_flows',
        format: 'jsonl',
        sharded: false,
        entrypoint: 'risk_partial_flows.jsonl',
        totalEntries: 1
      }
    }
  },
  summaries: [summaryRow],
  flows: [flowRow],
  partialFlows: [partialFlowRow],
  callSites: [callSiteRow],
  includeRiskPartialFlows: true
});
assert.equal(partialPack.risk?.analysisStatus?.artifactStatus?.partialFlows, 'present');
assert.equal(partialPack.risk?.provenance?.artifactRefs?.partialFlows?.entrypoint, 'risk_partial_flows.jsonl');
assert.equal(partialPack.risk?.partialFlows?.length, 1);
assert.equal(partialPack.risk?.partialFlows?.[0]?.partialFlowId, partialFlowRow.partialFlowId);
assert.equal(partialPack.risk?.partialFlows?.[0]?.frontier?.terminalReason, 'maxDepth');
assert.equal(partialPack.risk?.partialFlows?.[0]?.notes?.terminalReason, 'maxDepth');
assert.equal(partialPack.risk?.partialFlows?.[0]?.path?.watchByStep?.[0]?.calleeNormalized, 'query');
assert.equal(partialPack.risk?.partialFlows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.callSiteId, 'cs-1');
assert.equal(partialPack.risk?.analysisStatus?.partialFlowsEmitted, 1);
assert.ok(validateCompositeContextPack(partialPack).ok, 'expected partial risk slice to validate');
const partialRendered = renderCompositeContextPack(partialPack);
assert.ok(partialRendered.includes('Partial Risk Flows'), 'expected rendered partial flow section');
const partialRenderedJson = renderCompositeContextPackJson(partialPack);
assert.equal(partialRenderedJson.rendered?.risk?.partialFlowSelection?.totalPartialFlows, 1);
assert.equal(partialRenderedJson.rendered?.risk?.partialFlows?.[0]?.partialFlowId, partialFlowRow.partialFlowId);

const cappedPack = await buildPack({
  name: 'capped',
  stats: {
    ...baseStats,
    counts: {
      ...baseStats.counts,
      flowsEmitted: 4,
      uniqueCallSitesReferenced: 12
    }
  },
  summaries: [summaryRow],
  flows: [oversizedBudgetFlow, flowRow, rankedPathOnlyFlow, truncatedEvidenceFlow],
  callSites: extraCallSiteRows
});
assert.equal(cappedPack.risk?.status, 'ok');
assert.deepEqual(
  cappedPack.risk?.flows?.map((flow) => flow.flowId),
  [
    'sha1:1111111111111111111111111111111111111111',
    'sha1:3333333333333333333333333333333333333333',
    'sha1:2222222222222222222222222222222222222222'
  ],
  'expected deterministic ranking and byte-budget omission'
);
assert.equal(cappedPack.risk?.flows?.[0]?.rank, 2, 'expected selected flow to retain its original rank');
assert.equal(cappedPack.risk?.flows?.[2]?.score?.seedRelevance, 1, 'expected path-only flow to rank below direct source flow');
assert.equal(cappedPack.risk?.flows?.[1]?.path?.truncatedSteps, 1, 'expected step cap truncation');
assert.equal(cappedPack.risk?.flows?.[1]?.evidence?.callSitesByStep?.[0]?.length, 3, 'expected call-site cap truncation');
assert.equal(cappedPack.risk?.flows?.[1]?.path?.watchByStep?.length, 8, 'expected watch windows to truncate with path steps');
assert.ok(Array.isArray(cappedPack.risk?.caps?.hits) && cappedPack.risk.caps.hits.includes('maxRiskBytes'), 'expected byte-budget cap hit');
assert.ok(cappedPack.risk.caps.hits.includes('maxStepsPerFlow'), 'expected step cap hit');
assert.ok(cappedPack.risk.caps.hits.includes('maxCallSitesPerStep'), 'expected call-site cap hit');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxRiskBytes'), 'expected byte truncation record');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxStepsPerFlow'), 'expected step truncation record');
assert.ok(cappedPack.risk.truncation.some((entry) => entry.cap === 'maxCallSitesPerStep'), 'expected call-site truncation record');
assert.equal(validateCompositeContextPack(cappedPack).ok, true, 'expected capped risk slice to validate');

const longExcerptText = `query(${Array.from({ length: 32 }, (_, index) => `segment_${index}`).join(', ')})`;
const longSourceText = `export function risky(input) {\n  return ${longExcerptText};\n}\n`;
const longQueryOffset = longSourceText.indexOf(longExcerptText);
await fs.writeFile(repoFile, longSourceText, 'utf8');
const longExcerptPack = await buildPack({
  name: 'excerpt-capped',
  stats: {
    ...baseStats,
    counts: {
      ...baseStats.counts,
      flowsEmitted: 1,
      uniqueCallSitesReferenced: 1
    }
  },
  summaries: [summaryRow],
  flows: [flowRow],
  callSites: [{
    ...callSiteRow,
    start: longQueryOffset,
    end: longQueryOffset + longExcerptText.length,
    startLine: 2,
    startCol: 10,
    endLine: 2,
    endCol: 10 + longExcerptText.length
  }]
});
assert.equal(longExcerptPack.risk?.flows?.[0]?.evidence?.callSitesByStep?.[0]?.[0]?.details?.excerptTruncated, true, 'expected long call-site excerpt to truncate');
assert.ok(longExcerptPack.risk?.caps?.hits?.includes('maxCallSiteExcerptBytes'), 'expected call-site excerpt byte cap hit');
assert.ok(longExcerptPack.risk?.truncation?.some((entry) => entry.cap === 'maxCallSiteExcerptBytes'), 'expected call-site excerpt truncation record');

const filteredPack = await buildPack({
  name: 'filtered',
  stats: baseStats,
  summaries: [summaryRow],
  flows: [flowRow, rankedPathOnlyFlow],
  callSites: [callSiteRow],
  riskFilters: {
    flowId: flowRow.flowId,
    severity: 'high',
    sourceRule: 'source.req.body',
    sinkRule: 'sink.sql.query'
  }
});
assert.deepEqual(filteredPack.risk?.filters, {
  rule: [],
  category: [],
  severity: ['high'],
  tag: [],
  source: [],
  sink: [],
  sourceRule: ['source.req.body'],
  sinkRule: ['sink.sql.query'],
  flowId: [flowRow.flowId]
});
assert.deepEqual(filteredPack.risk?.flows?.map((flow) => flow.flowId), [flowRow.flowId], 'expected risk filters to narrow emitted flows');

assert.throws(
  () => assembleCompositeContextPack({
    seed: { type: 'chunk', chunkUid: 'chunk-risk' },
    chunkMeta,
    repoRoot,
    indexDir: path.join(tempRoot, 'full', 'index-code'),
    indexCompatKey: 'compat-test',
    now: fixedNow,
    includeGraph: false,
    includeTypes: false,
    includeRisk: true,
    riskFilters: { severity: 'urgent' },
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false
  }),
  /Invalid risk filters/
);

console.log('context pack risk assembly test passed');
