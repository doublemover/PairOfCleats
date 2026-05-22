#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { reconcileIndexIdentity } from '../../../src/index/identity/reconcile.js';
import { createBaseIndex } from '../validate/helpers.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'identity-reconcile-call-sites-and-risk');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const uidA = 'ck64:v1:repo:src/a.dart#seg:segu:v1:seg-a:0011223344556677';
const missingUid = 'ck64:v1:repo:src/missing.dart#seg:segu:v1:seg-x:ffeeddccbbaa9988';

const { indexDir, manifest } = await createBaseIndex({
  rootDir: tempRoot,
  chunkMeta: [
    {
      id: 0,
      file: 'src/a.dart',
      chunkId: 'chunk_0',
      chunkUid: uidA,
      virtualPath: 'src/a.dart#seg:segu:v1:seg-a',
      metaV2: {
        chunkId: 'chunk_0',
        chunkUid: uidA,
        virtualPath: 'src/a.dart#seg:segu:v1:seg-a',
        file: 'src/a.dart',
        mintedByStage: 'index.identity.chunk-uid.assignChunkUids',
        disambiguation: 'canonical-envelope',
        segment: { segmentUid: 'segu:v1:seg-a', virtualPath: 'src/a.dart#seg:segu:v1:seg-a' }
      }
    }
  ]
});

const callSites = [
  {
    callSiteId: 'callsite:a',
    callerChunkUid: uidA,
    file: 'src/a.dart',
    start: 0,
    end: 10,
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 10,
    calleeRaw: 'missing()',
    calleeNormalized: 'missing',
    args: [],
    targetChunkUid: missingUid
  }
];
const riskSummaries = [
  {
    schemaVersion: 1,
    chunkUid: missingUid,
    file: 'src/missing.dart',
    languageId: 'dart',
    symbol: {
      name: 'missing',
      kind: 'FunctionDeclaration',
      signature: 'missing()'
    },
    signals: {
      sources: [],
      sinks: [],
      sanitizers: [],
      localFlows: []
    },
    totals: {
      sources: 0,
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
  }
];
const riskFlows = [
  {
    schemaVersion: 1,
    flowId: 'sha1:1111111111111111111111111111111111111111',
    source: {
      chunkUid: uidA,
      ruleId: 'source.input',
      ruleName: 'input',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.6
    },
    sink: {
      chunkUid: missingUid,
      ruleId: 'sink.exec',
      ruleName: 'exec',
      ruleType: 'sink',
      category: 'exec',
      severity: 'high',
      confidence: 0.9
    },
    path: {
      chunkUids: [uidA, missingUid],
      callSiteIdsByStep: [['callsite:a']]
    },
    confidence: 0.9,
    notes: {
      strictness: 'conservative',
      sanitizerPolicy: 'terminate',
      hopCount: 1,
      sanitizerBarriersHit: 0,
      capsHit: []
    }
  }
];
const riskPartialFlows = [
  {
    schemaVersion: 1,
    partialFlowId: 'sha1:2222222222222222222222222222222222222222',
    source: {
      chunkUid: uidA,
      ruleId: 'source.input',
      ruleName: 'input',
      ruleType: 'source',
      category: 'input',
      severity: 'low',
      confidence: 0.6
    },
    frontier: {
      chunkUid: missingUid,
      terminalReason: 'maxDepth',
      blockedExpansions: [
        {
          targetChunkUid: missingUid,
          reason: 'maxEdgeExpansions',
          callSiteIds: ['callsite:a']
        }
      ]
    },
    path: {
      chunkUids: [uidA, missingUid],
      callSiteIdsByStep: [['callsite:a']]
    },
    confidence: 0.7,
    notes: {
      strictness: 'conservative',
      sanitizerPolicy: 'terminate',
      hopCount: 1,
      sanitizerBarriersHit: 0,
      capsHit: ['maxDepth'],
      terminalReason: 'maxDepth'
    }
  }
];

await writeJsonLinesFile(path.join(indexDir, 'call_sites.jsonl'), callSites, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'risk_summaries.jsonl'), riskSummaries, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'risk_flows.jsonl'), riskFlows, { atomic: true });
await writeJsonLinesFile(path.join(indexDir, 'risk_partial_flows.jsonl'), riskPartialFlows, { atomic: true });

manifest.pieces.push({ type: 'relations', name: 'call_sites', format: 'jsonl', path: 'call_sites.jsonl', count: callSites.length });
manifest.pieces.push({ type: 'risk', name: 'risk_summaries', format: 'jsonl', path: 'risk_summaries.jsonl', count: riskSummaries.length });
manifest.pieces.push({ type: 'risk', name: 'risk_flows', format: 'jsonl', path: 'risk_flows.jsonl', count: riskFlows.length });
manifest.pieces.push({ type: 'risk', name: 'risk_partial_flows', format: 'jsonl', path: 'risk_partial_flows.jsonl', count: riskPartialFlows.length });
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify(manifest, null, 2));

const report = await reconcileIndexIdentity({
  indexDir,
  mode: 'code',
  strict: true
});

assert.equal(report.ok, false, 'expected extended identity reconciliation to fail for drifted risk and call-site families');
assert.equal(report.counts.callSites, 1);
assert.equal(report.counts.riskSummaries, 1);
assert.equal(report.counts.riskFlows, 1);
assert.equal(report.counts.riskPartialFlows, 1);

const issueMessages = report.issues.map((issue) => issue.message).join('\n');
assert.match(issueMessages, /call_sites target chunkUid missing in chunk_meta/i);
assert.match(issueMessages, /risk_summaries chunkUid missing in chunk_meta/i);
assert.match(issueMessages, /risk_flows sink chunkUid missing in chunk_meta/i);
assert.match(issueMessages, /risk_partial_flows frontier chunkUid missing in chunk_meta/i);

const detectedStages = new Set(report.issues.map((issue) => issue.detectedByStage).filter(Boolean));
assert.equal(detectedStages.has('identity.reconcile.call_sites'), true);
assert.equal(detectedStages.has('identity.reconcile.risk_summaries'), true);
assert.equal(detectedStages.has('identity.reconcile.risk_flows'), true);
assert.equal(detectedStages.has('identity.reconcile.risk_partial_flows'), true);

console.log('identity reconcile call-sites and risk test passed');
