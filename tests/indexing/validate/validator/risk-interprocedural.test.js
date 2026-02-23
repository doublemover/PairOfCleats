#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../../src/shared/hash.js';
import { buildCallSiteId } from '../../../../src/index/callsite-id.js';
import { validateIndexArtifacts } from '../../../../src/index/validate.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { createBaseIndex, defaultUserConfig } from '../helpers.js';
import { updatePiecesManifest } from '../../../helpers/pieces-manifest.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'validator-risk-interprocedural');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMeta = [
  { id: 0, file: 'src/source.js', start: 0, end: 10, chunkUid: 'uid-source' },
  { id: 1, file: 'src/sink.js', start: 0, end: 8, chunkUid: 'uid-sink' }
];
const indexState = {
  generatedAt: new Date().toISOString(),
  mode: 'code',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  riskInterprocedural: {
    enabled: true,
    summaryOnly: false,
    emitArtifacts: 'jsonl'
  }
};

const tokenPostings = {
  vocab: ['alpha'],
  postings: [[[0, 1]]],
  docLengths: [1, 1],
  avgDocLen: 1,
  totalDocs: 2
};

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta,
  indexState,
  tokenPostings
});

const chunkUidMap = [
  { docId: 0, chunkUid: 'uid-source', chunkId: 'chunk_source', file: 'src/source.js', start: 0, end: 10 },
  { docId: 1, chunkUid: 'uid-sink', chunkId: 'chunk_sink', file: 'src/sink.js', start: 0, end: 8 }
];

const callSiteId = buildCallSiteId({
  file: 'src/source.js',
  startLine: 1,
  startCol: 1,
  endLine: 1,
  endCol: 5,
  calleeRaw: 'sink'
});

const callSites = [
  {
    callSiteId,
    callerChunkUid: 'uid-source',
    callerDocId: 0,
    file: 'src/source.js',
    languageId: 'javascript',
    start: 0,
    end: 5,
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 5,
    calleeRaw: 'sink',
    calleeNormalized: 'sink',
    args: ['value'],
    evidence: [],
    targetChunkUid: 'uid-sink',
    targetCandidates: [],
    snippetHash: null
  }
];

const riskSummaries = [
  {
    schemaVersion: 1,
    chunkUid: 'uid-source',
    file: 'src/source.js',
    languageId: 'javascript',
    symbol: { name: 'source', kind: 'Function', signature: null },
    signals: {
      sources: [
        {
          ruleId: 'source.req.body',
          ruleName: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: null,
          confidence: 0.6,
          tags: [],
          evidence: [
            {
              file: 'src/source.js',
              startLine: 1,
              startCol: 1,
              endLine: 1,
              endCol: 1,
              snippetHash: `sha1:${sha1('req.body')}`
            }
          ]
        }
      ],
      sinks: [],
      sanitizers: [],
      localFlows: []
    },
    totals: { sources: 1, sinks: 0, sanitizers: 0, localFlows: 0 },
    truncated: { sources: false, sinks: false, sanitizers: false, localFlows: false, evidence: false }
  },
  {
    schemaVersion: 1,
    chunkUid: 'uid-sink',
    file: 'src/sink.js',
    languageId: 'javascript',
    symbol: { name: 'sink', kind: 'Function', signature: null },
    signals: {
      sources: [],
      sinks: [
        {
          ruleId: 'sink.eval',
          ruleName: 'eval',
          ruleType: 'sink',
          category: 'code-exec',
          severity: 'high',
          confidence: 0.8,
          tags: [],
          evidence: [
            {
              file: 'src/sink.js',
              startLine: 1,
              startCol: 1,
              endLine: 1,
              endCol: 1,
              snippetHash: `sha1:${sha1('eval')}`
            }
          ]
        }
      ],
      sanitizers: [],
      localFlows: []
    },
    totals: { sources: 0, sinks: 1, sanitizers: 0, localFlows: 0 },
    truncated: { sources: false, sinks: false, sanitizers: false, localFlows: false, evidence: false }
  }
];

const flowId = `sha1:${sha1('uid-source|source.req.body|uid-sink|sink.eval|uid-source>uid-sink')}`;
const riskFlows = [
  {
    schemaVersion: 1,
    flowId,
    source: {
      chunkUid: 'uid-source',
      ruleId: 'source.req.body',
      ruleName: 'req.body',
      ruleType: 'source',
      category: 'input',
      severity: null,
      confidence: 0.6
    },
    sink: {
      chunkUid: 'uid-sink',
      ruleId: 'sink.eval',
      ruleName: 'eval',
      ruleType: 'sink',
      category: 'code-exec',
      severity: 'high',
      confidence: 0.8
    },
    path: {
      chunkUids: ['uid-source', 'uid-sink'],
      callSiteIdsByStep: [[callSiteId]]
    },
    confidence: 0.5,
    notes: {
      strictness: 'conservative',
      sanitizerPolicy: 'terminate',
      hopCount: 1,
      sanitizerBarriersHit: 0,
      capsHit: []
    }
  }
];

const stats = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: 'code',
  status: 'ok',
  reason: null,
  effectiveConfig: {
    enabled: true,
    summaryOnly: false,
    strictness: 'conservative',
    emitArtifacts: 'jsonl',
    sanitizerPolicy: 'terminate',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 3,
      maxTotalFlows: 100,
      maxCallSitesPerEdge: 2,
      maxEdgeExpansions: 100,
      maxMs: null
    }
  },
  counts: {
    chunksConsidered: 2,
    summariesEmitted: 2,
    sourceRoots: 1,
    resolvedEdges: 1,
    flowsEmitted: 1,
    risksWithFlows: 1,
    uniqueCallSitesReferenced: 1
  },
  callSiteSampling: {
    strategy: 'firstN',
    maxCallSitesPerEdge: 2,
    order: 'file,startLine,startCol,endLine,endCol,calleeNormalized,calleeRaw,callSiteId'
  },
  capsHit: [],
  timingMs: { summaries: 0, propagation: 0, io: 0, total: 0 },
  artifacts: {}
};

const writeJsonl = async (filePath, rows) => {
  const payload = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(filePath, payload);
};

await writeJsonl(path.join(indexDir, 'call_sites.jsonl'), callSites);
await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), riskSummaries);
await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), riskFlows);
await fs.writeFile(path.join(indexDir, 'risk_interprocedural_stats.json'), JSON.stringify(stats, null, 2));
await fs.writeFile(path.join(indexDir, 'chunk_uid_map.json'), JSON.stringify(chunkUidMap, null, 2));

await updatePiecesManifest(indexDir, (manifest) => {
  manifest.pieces.push(
    { type: 'relations', name: 'call_sites', format: 'jsonl', path: 'call_sites.jsonl' },
    { type: 'chunks', name: 'chunk_uid_map', format: 'json', path: 'chunk_uid_map.json' },
    { type: 'risk', name: 'risk_summaries', format: 'jsonl', path: 'risk_summaries.jsonl' },
    { type: 'risk', name: 'risk_flows', format: 'jsonl', path: 'risk_flows.jsonl' },
    { type: 'risk', name: 'risk_interprocedural_stats', format: 'json', path: 'risk_interprocedural_stats.json' }
  );
});

let report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});
assert.ok(report.ok, `expected validation to pass, got issues: ${report.issues.join('; ')}`);

const corrupted = riskFlows.map((row) => ({
  ...row,
  path: { ...row.path, callSiteIdsByStep: [['sha1:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']] }
}));
await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), corrupted);
report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});
assert.ok(!report.ok, 'expected validation to fail with bad callSiteId');
assert.ok(report.issues.some((issue) => issue.includes('callSiteId')), 'expected callSiteId issue');

console.log('risk interprocedural validator test passed');
