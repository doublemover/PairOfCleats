#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { assembleCompositeContextPack } from '../../../src/context-pack/assemble.js';
import { getMetricsRegistry } from '../../../src/shared/metrics.js';
import { createApiRouter } from '../../../tools/api/router.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'api-risk-pack-metrics');
const repoRoot = path.join(tempRoot, 'repo');
const indexDir = path.join(repoRoot, '.pairofcleats', 'index-code');
const repoFile = path.join(repoRoot, 'src', 'file.js');
const repoSource = 'export function risky(input) {\n  return query(input);\n}\n';
const queryExcerpt = 'query(input)';
const queryOffset = repoSource.indexOf(queryExcerpt);

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(repoFile, repoSource, 'utf8');

const writeJsonl = async (filePath, rows) => {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf8');
};

const buildFlowId = (digit) => `sha1:${String(digit).repeat(40)}`;

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
      tags: ['input'],
      evidence: []
    }],
    sinks: [{
      ruleId: 'sink.sql.query',
      ruleName: 'sql.query',
      ruleType: 'sink',
      category: 'injection',
      severity: 'high',
      confidence: 0.9,
      tags: ['sql'],
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

const baseStats = {
  schemaVersion: 1,
  generatedAt: '2026-03-19T00:00:00.000Z',
  mode: 'code',
  status: 'ok',
  reason: null,
  effectiveConfig: {
    enabled: true,
    summaryOnly: false,
    emitArtifacts: 'jsonl'
  },
  counts: {
    flowsEmitted: 6,
    uniqueCallSitesReferenced: 12
  },
  capsHit: [],
  provenance: {
    indexSignature: 'sig-risk-pack-metrics',
    indexCompatKey: 'compat-risk-pack-metrics',
    effectiveConfigFingerprint: 'sha1:config-risk-pack-metrics'
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
      totalEntries: 6
    },
    callSites: {
      name: 'call_sites',
      format: 'jsonl',
      sharded: false,
      entrypoint: 'call_sites.jsonl',
      totalEntries: 12
    }
  }
};

const buildWatchStep = (index) => ({
  taintIn: ['req.body'],
  taintOut: ['input'],
  propagatedArgIndices: [0],
  boundParams: ['input'],
  calleeNormalized: `query${index}`,
  sanitizerPolicy: 'terminate',
  sanitizerBarrierApplied: false,
  sanitizerBarriersBefore: 0,
  sanitizerBarriersAfter: 0,
  confidenceBefore: 0.6,
  confidenceAfter: 0.51,
  confidenceDelta: -0.09
});

const buildFlow = ({
  digit,
  confidence,
  stepCount = 1,
  firstStepCallSites = ['cs-1']
}) => ({
  schemaVersion: 1,
  flowId: buildFlowId(digit),
  source: {
    chunkUid: 'chunk-risk',
    ruleId: 'source.req.body',
    ruleName: 'req.body',
    ruleType: 'source',
    category: 'input',
    severity: 'low',
    confidence: 0.6,
    tags: ['input']
  },
  sink: {
    chunkUid: `chunk-risk-sink-${digit}`,
    ruleId: 'sink.sql.query',
    ruleName: 'sql.query',
    ruleType: 'sink',
    category: 'injection',
    severity: 'high',
    confidence: 0.9,
    tags: ['sql']
  },
  path: {
    chunkUids: ['chunk-risk', ...Array.from({ length: stepCount }, (_, index) => `chunk-step-${digit}-${index + 1}`)],
    callSiteIdsByStep: [
      firstStepCallSites,
      ...Array.from({ length: Math.max(0, stepCount - 1) }, (_, index) => [`cs-${index + 2}`])
    ],
    watchByStep: Array.from({ length: stepCount }, (_, index) => buildWatchStep(index + 1))
  },
  confidence,
  notes: {
    strictness: 'conservative',
    sanitizerPolicy: 'terminate',
    hopCount: stepCount,
    sanitizerBarriersHit: 0,
    capsHit: []
  }
});

const callSiteRows = Array.from({ length: 12 }, (_, index) => ({
  callSiteId: `cs-${index + 1}`,
  callerChunkUid: 'chunk-risk',
  file: 'src/file.js',
  languageId: 'javascript',
  start: queryOffset,
  end: queryOffset + queryExcerpt.length,
  startLine: 2,
  startCol: 10,
  endLine: 2,
  endCol: 22,
  calleeRaw: 'query',
  calleeNormalized: 'query',
  args: ['input']
}));

const flows = [
  buildFlow({ digit: 1, confidence: 0.99, stepCount: 9, firstStepCallSites: ['cs-1', 'cs-2', 'cs-3', 'cs-4'] }),
  buildFlow({ digit: 2, confidence: 0.98 }),
  buildFlow({ digit: 3, confidence: 0.97 }),
  buildFlow({ digit: 4, confidence: 0.96 }),
  buildFlow({ digit: 5, confidence: 0.95 }),
  buildFlow({ digit: 6, confidence: 0.94 })
];

await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), { fields: baseStats });
await writeJsonl(path.join(indexDir, 'risk_summaries.jsonl'), [summaryRow]);
await writeJsonl(path.join(indexDir, 'risk_flows.jsonl'), flows);
await writeJsonl(path.join(indexDir, 'call_sites.jsonl'), callSiteRows);
await writeJsonObjectFile(path.join(indexDir, 'meta.json'), {
  fields: {
    version: 1,
    createdAt: '2026-03-19T00:00:00.000Z'
  }
});
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
  fields: {
    version: 2,
    artifactSurfaceVersion: 'test',
    compatibilityKey: 'compat-risk-pack-metrics',
    generatedAt: '2026-03-19T00:00:00.000Z',
    mode: 'code',
    stage: 'risk-pack-metrics-test',
    pieces: [
      { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' },
      { name: 'risk_summaries', path: 'risk_summaries.jsonl', format: 'jsonl' },
      { name: 'risk_flows', path: 'risk_flows.jsonl', format: 'jsonl' },
      { name: 'call_sites', path: 'call_sites.jsonl', format: 'jsonl' }
    ]
  }
});

const pack = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-risk' },
  chunkMeta: [{
    id: 0,
    file: 'src/file.js',
    chunkUid: 'chunk-risk',
    start: 0,
    end: repoSource.length,
    startLine: 1,
    endLine: 3
  }],
  repoRoot,
  indexDir,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  indexCompatKey: 'compat-risk-pack-metrics',
  indexSignature: 'sig-risk-pack-metrics',
  now: () => '2026-03-19T00:00:00.000Z'
});

assert.equal(pack.risk?.analysisStatus?.code, 'capped', 'expected synthetic pack to exercise capped metrics');

const router = createApiRouter({
  host: '127.0.0.1',
  defaultRepo: repoRoot,
  defaultOutput: 'json',
  metricsRegistry: getMetricsRegistry()
});
const server = http.createServer((req, res) => router.handleRequest(req, res));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const metricsBody = await new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1',
    port,
    path: '/metrics',
    method: 'GET'
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });
    res.on('end', () => resolve(body));
  });
  req.on('error', reject);
  req.end();
});

try {
  assert.match(
    metricsBody,
    /pairofcleats_risk_pack_caps_hit_total\{status="capped",cap="max_flows"\} 1\b/,
    'expected max_flows cap-hit metric'
  );
  assert.match(
    metricsBody,
    /pairofcleats_risk_pack_caps_hit_total\{status="capped",cap="max_steps_per_flow"\} 1\b/,
    'expected max_steps_per_flow cap-hit metric'
  );
  assert.match(
    metricsBody,
    /pairofcleats_risk_pack_dropped_flows_total\{status="capped",flow_kind="full"\} 1\b/,
    'expected dropped full-flow metric'
  );
  assert.match(
    metricsBody,
    /pairofcleats_risk_pack_truncation_total\{status="capped",cap="max_flows",scope="risk"\} 1\b/,
    'expected max_flows truncation metric'
  );
  assert.match(
    metricsBody,
    /pairofcleats_risk_pack_truncation_total\{status="capped",cap="max_call_sites_per_step",scope="risk"\} 1\b/,
    'expected call-site truncation metric'
  );
} finally {
  server.close();
  if (typeof router.close === 'function') router.close();
}

console.log('API risk pack metrics test passed');
