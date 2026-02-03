#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadJsonObjectArtifact,
  loadPiecesManifest
} from '../../src/shared/artifact-io.js';

const argv = createCli({
  scriptName: 'risk explain',
  options: {
    index: { type: 'string' },
    chunk: { type: 'string' },
    max: { type: 'number', default: 20 },
    'source-rule': { type: 'string' },
    'sink-rule': { type: 'string' },
    json: { type: 'boolean', default: false }
  }
}).parse();

const indexArg = argv.index ? String(argv.index) : '';
const chunkArg = argv.chunk ? String(argv.chunk) : '';
if (!indexArg || !chunkArg) {
  console.error('Usage: pairofcleats risk explain --index <dir> --chunk <chunkUid> [--max N]');
  process.exit(1);
}

const indexDir = path.resolve(indexArg);
if (!fs.existsSync(indexDir)) {
  console.error(`Missing index directory: ${indexDir}`);
  process.exit(1);
}

const manifest = loadPiecesManifest(indexDir, { strict: true });
const chunkMeta = await loadChunkMeta(indexDir, { manifest, strict: true });
const resolveChunkUid = (entry) => entry?.chunkUid || entry?.metaV2?.chunkUid || null;
const resolveChunkFile = (entry) => entry?.file || entry?.metaV2?.file || entry?.virtualPath || null;
const resolveChunkName = (entry) => entry?.name || entry?.metaV2?.symbol?.name || entry?.metaV2?.name || null;
const resolveChunkKind = (entry) => entry?.kind || entry?.metaV2?.symbol?.kind || null;

const chunkByUid = new Map();
for (const entry of chunkMeta) {
  const uid = resolveChunkUid(entry);
  if (uid) chunkByUid.set(uid, entry);
}

const targetChunk = chunkByUid.get(chunkArg) || null;
if (!targetChunk) {
  console.error(`Unknown chunkUid: ${chunkArg}`);
  process.exit(1);
}

const safeLoadArray = async (name) => {
  try {
    return await loadJsonArrayArtifact(indexDir, name, { manifest, strict: true });
  } catch {
    return null;
  }
};
const safeLoadObject = async (name) => {
  try {
    return await loadJsonObjectArtifact(indexDir, name, { manifest, strict: true });
  } catch {
    return null;
  }
};

const riskSummaries = await safeLoadArray('risk_summaries');
const riskFlows = await safeLoadArray('risk_flows');
const callSites = await safeLoadArray('call_sites');
const stats = await safeLoadObject('risk_interprocedural_stats');

const summaryRow = Array.isArray(riskSummaries)
  ? riskSummaries.find((row) => row?.chunkUid === chunkArg)
  : null;

const summaryFromChunk = targetChunk?.docmeta?.risk?.summary || targetChunk?.metaV2?.risk?.summary || null;
const summary = summaryFromChunk || (summaryRow ? {
  sources: { count: summaryRow?.totals?.sources || 0 },
  sinks: { count: summaryRow?.totals?.sinks || 0 },
  sanitizers: { count: summaryRow?.totals?.sanitizers || 0 },
  localFlows: { count: summaryRow?.totals?.localFlows || 0 }
} : null);

const callSiteById = new Map();
if (Array.isArray(callSites)) {
  for (const entry of callSites) {
    if (entry?.callSiteId) callSiteById.set(entry.callSiteId, entry);
  }
}

const matchesRule = (flow, sourceRule, sinkRule) => {
  if (sourceRule && flow?.source?.ruleId !== sourceRule) return false;
  if (sinkRule && flow?.sink?.ruleId !== sinkRule) return false;
  return true;
};

const flows = Array.isArray(riskFlows) ? riskFlows : [];
const sourceRule = argv['source-rule'] ? String(argv['source-rule']) : null;
const sinkRule = argv['sink-rule'] ? String(argv['sink-rule']) : null;
const matchingFlows = flows.filter((flow) => {
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  const isRelevant = flow?.source?.chunkUid === chunkArg
    || flow?.sink?.chunkUid === chunkArg
    || chunkUids.includes(chunkArg);
  if (!isRelevant) return false;
  return matchesRule(flow, sourceRule, sinkRule);
});

matchingFlows.sort((a, b) => {
  const confA = Number.isFinite(a?.confidence) ? a.confidence : -1;
  const confB = Number.isFinite(b?.confidence) ? b.confidence : -1;
  if (confA !== confB) return confB - confA;
  const idA = a?.flowId || '';
  const idB = b?.flowId || '';
  return idA.localeCompare(idB);
});

const max = Number.isFinite(argv.max) ? Math.max(1, Math.floor(argv.max)) : 20;
const limitedFlows = matchingFlows.slice(0, max);

const formatChunkLabel = (uid) => {
  const entry = chunkByUid.get(uid) || null;
  const file = resolveChunkFile(entry) || null;
  const symbol = resolveChunkName(entry) || null;
  if (file && symbol) return `${file}::${symbol}`;
  if (file) return file;
  return uid || 'unknown';
};

const formatCallSite = (site) => {
  if (!site) return 'unknown call site';
  const file = site.file || 'unknown-file';
  const loc = site.startLine ? `${site.startLine}:${site.startCol || 1}` : '?:?';
  const callee = site.calleeNormalized || site.calleeRaw || 'call';
  const args = Array.isArray(site.args) ? site.args.join(', ') : '';
  return `${file}:${loc} ${callee}${args ? `(${args})` : ''}`;
};

const buildFlowPayload = (flow) => {
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  const stepIds = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
  const callSitesByStep = stepIds.map((ids) => (ids || []).map((id) => ({
    callSiteId: id,
    details: callSiteById.get(id) || null
  })));
  return {
    flowId: flow?.flowId || null,
    confidence: flow?.confidence ?? null,
    source: flow?.source || null,
    sink: flow?.sink || null,
    notes: flow?.notes || null,
    path: {
      chunkUids,
      labels: chunkUids.map((uid) => formatChunkLabel(uid)),
      callSiteIdsByStep: stepIds
    },
    callSitesByStep
  };
};

if (argv.json) {
  const output = {
    chunk: {
      chunkUid: chunkArg,
      file: resolveChunkFile(targetChunk),
      name: resolveChunkName(targetChunk),
      kind: resolveChunkKind(targetChunk)
    },
    summary,
    stats: stats || null,
    filters: { sourceRule, sinkRule },
    flows: limitedFlows.map(buildFlowPayload)
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

const headerFile = resolveChunkFile(targetChunk) || 'unknown-file';
const headerName = resolveChunkName(targetChunk);
const headerKind = resolveChunkKind(targetChunk);
console.log(`Chunk ${chunkArg}`);
console.log(`- file: ${headerFile}`);
if (headerName) {
  console.log(`- symbol: ${headerName}${headerKind ? ` (${headerKind})` : ''}`);
}
if (summary) {
  const sources = summary?.sources?.count ?? 0;
  const sinks = summary?.sinks?.count ?? 0;
  const sanitizers = summary?.sanitizers?.count ?? 0;
  const localFlows = summary?.localFlows?.count ?? 0;
  const categories = Array.isArray(summary?.topCategories) ? summary.topCategories.join(', ') : '';
  const tags = Array.isArray(summary?.topTags) ? summary.topTags.join(', ') : '';
  console.log(`- summary: sources ${sources}, sinks ${sinks}, sanitizers ${sanitizers}, localFlows ${localFlows}`);
  if (categories) console.log(`  top categories: ${categories}`);
  if (tags) console.log(`  top tags: ${tags}`);
}
if (stats) {
  const flowsEmitted = stats?.counts?.flowsEmitted ?? null;
  const callSitesReferenced = stats?.counts?.uniqueCallSitesReferenced ?? null;
  const status = stats?.status || 'unknown';
  const caps = Array.isArray(stats?.capsHit) ? stats.capsHit.join(', ') : '';
  console.log(`- interprocedural: status ${status}` +
    `${flowsEmitted !== null ? `, flows ${flowsEmitted}` : ''}` +
    `${callSitesReferenced !== null ? `, call sites ${callSitesReferenced}` : ''}` +
    `${caps ? `, caps hit: ${caps}` : ''}`);
}

if (!limitedFlows.length) {
  console.log('No interprocedural flows found for this chunk.');
  process.exit(0);
}

console.log(`Flows (${limitedFlows.length}/${matchingFlows.length})`);
for (const flow of limitedFlows) {
  const confidence = Number.isFinite(flow?.confidence) ? flow.confidence.toFixed(2) : 'n/a';
  console.log(`- [${confidence}] ${flow.flowId || 'unknown-flow'}`);
  if (flow?.source?.ruleId || flow?.sink?.ruleId) {
    const sourceRuleId = flow?.source?.ruleId || 'unknown-source';
    const sinkRuleId = flow?.sink?.ruleId || 'unknown-sink';
    console.log(`  rules: ${sourceRuleId} -> ${sinkRuleId}`);
  }
  const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
  if (chunkUids.length) {
    const pathLabels = chunkUids.map((uid) => formatChunkLabel(uid));
    console.log(`  path: ${pathLabels.join(' -> ')}`);
  }
  const steps = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
  if (steps.length && callSiteById.size) {
    for (let idx = 0; idx < steps.length; idx += 1) {
      const ids = steps[idx] || [];
      if (!ids.length) continue;
      const rendered = ids.map((id) => formatCallSite(callSiteById.get(id))).join('; ');
      console.log(`  step ${idx + 1}: ${rendered}`);
    }
  }
}
