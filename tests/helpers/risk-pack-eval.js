import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createBaseIndex } from '../indexing/validate/helpers.js';
import { replaceDir } from '../../src/shared/json-stream/atomic.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';

const GOLDENS_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'context-pack', 'risk-pack-goldens.json');
const GATES_PATH = path.join(process.cwd(), 'tests', 'fixtures', 'context-pack', 'risk-pack-gates.json');
const RISK_PACK_EVAL_GENERATED_AT = '2026-03-19T13:00:00.000Z';
const RISK_PACK_EVAL_COMPATIBILITY_KEY = 'compat-risk-pack-eval';

const RISK_QUERY_EXCERPT = 'query(input)';
const RISK_ARTIFACT_PIECES = [
  { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
  { name: 'file_meta', path: 'file_meta.json', format: 'json' },
  { name: 'token_postings', path: 'token_postings.json', format: 'json' },
  { name: 'index_state', path: 'index_state.json', format: 'json' },
  { name: 'filelists', path: '.filelists.json', format: 'json' },
  { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' },
  { name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' },
  { name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' },
  { name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' }
];

export const writeJsonl = async (filePath, rows) => {
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, body ? `${body}\n` : '', 'utf8');
};

const buildRiskCalleeNormalized = (alias, index) => (
  index === null || index === undefined ? `query_${alias}` : `query_${alias}_${index}`
);

const buildRiskWatchStep = (alias, index = null) => ({
  taintIn: ['req.body'],
  taintOut: ['input'],
  propagatedArgIndices: [0],
  boundParams: ['input'],
  calleeNormalized: buildRiskCalleeNormalized(alias, index),
  sanitizerPolicy: 'terminate',
  sanitizerBarrierApplied: false,
  sanitizerBarriersBefore: 0,
  sanitizerBarriersAfter: 0,
  confidenceBefore: 0.8,
  confidenceAfter: 0.7,
  confidenceDelta: -0.1
});

const buildRiskSource = () => ({
  chunkUid: 'chunk-risk',
  ruleId: 'source.req.body',
  ruleName: 'req.body',
  ruleType: 'source',
  category: 'input',
  severity: 'low',
  confidence: 0.7,
  tags: ['input']
});

const buildRiskSink = (chunkUid) => ({
  chunkUid,
  ruleId: 'sink.sql.query',
  ruleName: 'sql.query',
  ruleType: 'sink',
  category: 'injection',
  severity: 'high',
  confidence: 0.9,
  tags: ['sql']
});

const buildRiskNotes = () => ({
  strictness: 'conservative',
  sanitizerPolicy: 'terminate',
  hopCount: 1,
  sanitizerBarriersHit: 0,
  capsHit: []
});

export const buildRiskFlow = ({
  alias,
  flowId,
  sinkChunkUid = `chunk-sink-${alias}`,
  callSiteIdsByStep = [[`cs-${alias}`]],
  watchByStep = [buildRiskWatchStep(alias)],
  confidence = 0.9
}) => ({
  schemaVersion: 1,
  flowId,
  source: buildRiskSource(),
  sink: buildRiskSink(sinkChunkUid),
  path: {
    chunkUids: ['chunk-risk', sinkChunkUid],
    callSiteIdsByStep,
    watchByStep
  },
  confidence,
  notes: buildRiskNotes()
});

export const buildRiskSummary = ({
  fileRelPath,
  languageId,
  symbolName,
  symbolKind,
  signature
}) => ({
  schemaVersion: 1,
  chunkUid: 'chunk-risk',
  file: fileRelPath,
  languageId,
  symbol: {
    name: symbolName,
    kind: symbolKind,
    signature
  },
  signals: {
    sources: [],
    sinks: [],
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
});

export const buildRiskStatsFields = ({
  generatedAt,
  flowsEmitted,
  uniqueCallSitesReferenced,
  maxCallSitesPerEdge
}) => ({
  fields: {
    schemaVersion: 1,
    generatedAt,
    mode: 'code',
    status: 'ok',
    reason: null,
    effectiveConfig: {
      enabled: true,
      summaryOnly: false,
      emitArtifacts: 'jsonl'
    },
    counts: {
      flowsEmitted,
      summariesEmitted: 1,
      uniqueCallSitesReferenced
    },
    callSiteSampling: {
      strategy: 'firstN',
      maxCallSitesPerEdge,
      order: 'deterministic'
    },
    capsHit: [],
    timingMs: {
      summaries: 1,
      propagation: 1,
      io: 1,
      total: 3
    }
  }
});

export const buildRiskCallSite = ({
  callSiteId,
  fileRelPath,
  languageId,
  queryOffset,
  queryExcerpt = RISK_QUERY_EXCERPT
}) => ({
  callSiteId,
  callerChunkUid: 'chunk-risk',
  file: fileRelPath,
  languageId,
  start: queryOffset,
  end: queryOffset + queryExcerpt.length,
  startLine: 2,
  startCol: 10,
  endLine: 2,
  endCol: 22,
  calleeRaw: 'query',
  calleeNormalized: 'query',
  args: ['input']
});

export const findRiskQueryOffset = (sourceText) => sourceText.indexOf(RISK_QUERY_EXCERPT);

export const buildRiskPiecesManifestFields = ({
  compatibilityKey,
  generatedAt,
  stage
}) => ({
  fields: {
    version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    compatibilityKey,
    generatedAt,
    mode: 'code',
    stage,
    pieces: RISK_ARTIFACT_PIECES.map((piece) => ({ ...piece }))
  }
});

export const createRiskRepoIndexFixture = async ({
  repoPath,
  cacheRoot,
  fileRelPath,
  sourceText,
  alias,
  generatedAt,
  compatibilityKey
}) => {
  const fileAbsPath = path.join(repoPath, fileRelPath);
  await fs.mkdir(path.dirname(fileAbsPath), { recursive: true });
  const gitInit = spawnSync('git', ['init', '-q'], {
    cwd: repoPath,
    encoding: 'utf8'
  });
  assert.equal(gitInit.status, 0, `expected git init to succeed for ${repoPath}`);
  await fs.writeFile(fileAbsPath, sourceText, 'utf8');
  await fs.writeFile(path.join(repoPath, '.pairofcleats.json'), `${JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2)}\n`, 'utf8');

  const repoCacheRoot = getRepoCacheRoot(repoPath);
  const buildId = `build-${alias}`;
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), `${JSON.stringify({
    buildId,
    buildRoot,
    modes: ['code']
  }, null, 2)}\n`, 'utf8');

  const { indexDir } = await createBaseIndex({
    rootDir: buildRoot,
    chunkMeta: [{
      id: 0,
      file: fileRelPath,
      chunkUid: 'chunk-risk',
      start: 0,
      end: sourceText.length,
      startLine: 1,
      endLine: 2
    }],
    tokenPostings: {
      vocab: ['query', alias],
      postings: [
        [[0, 1]],
        [[0, 1]]
      ],
      docLengths: [2],
      avgDocLen: 2,
      totalDocs: 1
    },
    indexState: {
      generatedAt,
      mode: 'code',
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey
    }
  });
  const finalIndexDir = path.join(buildRoot, 'index-code');
  await replaceDir(indexDir, finalIndexDir);
  await fs.rm(path.join(buildRoot, '.index-root'), { recursive: true, force: true });

  return { finalIndexDir };
};

const resolveCaseSource = ({ alias, languageId }) => {
  if (languageId === 'python') {
    return {
      fileRelPath: `src/${alias}.py`,
      sourceText: `def ${alias}(input):\n    return query(input)\n`,
      symbolKind: 'FunctionDefinition'
    };
  }
  return {
    fileRelPath: `src/${alias}.js`,
    sourceText: `export function ${alias}(input) {\n  return query(input);\n}\n`,
    symbolKind: 'FunctionDeclaration'
  };
};

const buildCappedFlows = (alias, flowIds) => flowIds.map((flowId, index) => {
  const flowIndex = index + 1;
  return buildRiskFlow({
    alias,
    flowId,
    sinkChunkUid: `chunk-sink-${alias}-${flowIndex}`,
    callSiteIdsByStep: [[
      `cs-${alias}-${flowIndex}-1`,
      `cs-${alias}-${flowIndex}-2`,
      `cs-${alias}-${flowIndex}-3`,
      `cs-${alias}-${flowIndex}-4`
    ]],
    watchByStep: [buildRiskWatchStep(alias, flowIndex)],
    confidence: 0.99 - (index * 0.01)
  });
});

const buildFlows = ({ alias, caseDef }) => {
  if (caseDef.expected?.capBehavior?.status === 'capped') {
    const emitted = Array.isArray(caseDef.expected?.flowIds) ? caseDef.expected.flowIds : [];
    const overflow = ['f', 'g'].map((token) => `sha1:${token.repeat(40)}`);
    return buildCappedFlows(alias, [...emitted, ...overflow]);
  }
  return [buildRiskFlow({
    alias,
    flowId: caseDef.expected.flowIds[0],
    callSiteIdsByStep: [[`cs-${alias}-1`]],
    watchByStep: [buildRiskWatchStep(alias, 1)]
  })];
};

const buildCallSites = ({ alias, caseDef, fileRelPath, sourceText }) => {
  const queryOffset = findRiskQueryOffset(sourceText);
  const flowCount = caseDef.expected?.capBehavior?.status === 'capped' ? 7 : 1;
  const rows = [];
  for (let index = 0; index < flowCount; index += 1) {
    const callSitesPerFlow = caseDef.expected?.capBehavior?.status === 'capped' ? 4 : 1;
    for (let step = 0; step < callSitesPerFlow; step += 1) {
      const callSiteSuffix = callSitesPerFlow > 1 ? `-${step + 1}` : '';
      rows.push(buildRiskCallSite({
        callSiteId: `cs-${alias}-${index + 1}${callSiteSuffix}`,
        fileRelPath,
        languageId: caseDef.languageId,
        queryOffset
      }));
    }
  }
  return rows;
};

const createRiskRepo = async ({ repoPath, cacheRoot, caseDef }) => {
  const { fileRelPath, sourceText, symbolKind } = resolveCaseSource(caseDef);
  const { finalIndexDir } = await createRiskRepoIndexFixture({
    repoPath,
    cacheRoot,
    fileRelPath,
    sourceText,
    alias: caseDef.repoAlias,
    generatedAt: RISK_PACK_EVAL_GENERATED_AT,
    compatibilityKey: RISK_PACK_EVAL_COMPATIBILITY_KEY
  });

  const flows = buildFlows({ alias: caseDef.repoAlias, caseDef });
  const callSites = buildCallSites({
    alias: caseDef.repoAlias,
    caseDef,
    fileRelPath,
    sourceText
  });

  await writeJsonObjectFile(path.join(finalIndexDir, 'risk_interprocedural_stats.json'), buildRiskStatsFields({
    generatedAt: RISK_PACK_EVAL_GENERATED_AT,
    flowsEmitted: flows.length,
    uniqueCallSitesReferenced: callSites.length,
    maxCallSitesPerEdge: 4
  }));
  await writeJsonl(path.join(finalIndexDir, 'risk_summaries.jsonl'), [buildRiskSummary({
    fileRelPath,
    languageId: caseDef.languageId,
    symbolName: caseDef.expected.summary.symbol.name,
    symbolKind,
    signature: caseDef.expected.summary.symbol.signature
  })]);
  await writeJsonl(path.join(finalIndexDir, 'risk_flows.jsonl'), flows);
  await writeJsonl(path.join(finalIndexDir, 'call_sites.jsonl'), callSites);
  await writeJsonObjectFile(path.join(finalIndexDir, 'pieces', 'manifest.json'), buildRiskPiecesManifestFields({
    compatibilityKey: RISK_PACK_EVAL_COMPATIBILITY_KEY,
    generatedAt: RISK_PACK_EVAL_GENERATED_AT,
    stage: 'risk-pack-eval-test'
  }));
};

export const createRiskPackEvalFixtureSet = async (tempRoot) => {
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'repos');
  const datasetPath = path.join(tempRoot, 'risk-pack-eval.dataset.json');
  const gatesPath = path.join(tempRoot, 'risk-pack-eval.gates.json');
  const goldenDefs = JSON.parse(await fs.readFile(GOLDENS_PATH, 'utf8'));
  const gates = JSON.parse(await fs.readFile(GATES_PATH, 'utf8'));

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });

  const cases = [];
  for (const caseDef of goldenDefs) {
    const resolvedRepoPath = path.join(repoRoot, caseDef.repoAlias);
    await createRiskRepo({
      repoPath: resolvedRepoPath,
      cacheRoot,
      caseDef
    });
    cases.push({
      ...caseDef,
      repoPath: resolvedRepoPath
    });
  }

  await fs.writeFile(datasetPath, `${JSON.stringify(cases, null, 2)}\n`, 'utf8');
  await fs.writeFile(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, 'utf8');
  return {
    datasetPath,
    gatesPath,
    cases
  };
};
