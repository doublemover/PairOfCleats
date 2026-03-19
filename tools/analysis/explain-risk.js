#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadJsonObjectArtifact,
  loadPiecesManifest
} from '../../src/shared/artifact-io.js';
import {
  buildRiskExplanationPresentationFromStandalone
} from '../../src/retrieval/output/risk-explain.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import {
  filterRiskFlows,
  filterRiskPartialFlows,
  normalizeRiskFilters,
  validateRiskFilters
} from '../../src/shared/risk-filters.js';
import { emitCliError, emitCliOutput, resolveFormat } from '../../src/integrations/tooling/cli-helpers.js';

const RISK_EXPLAIN_OPTIONS = Object.freeze({
  index: { type: 'string' },
  chunk: { type: 'string' },
  max: { type: 'number', default: 20 },
  includePartialFlows: { type: 'boolean', default: false },
  maxPartialFlows: { type: 'number', default: 20 },
  rule: { type: 'string' },
  category: { type: 'string' },
  severity: { type: 'string' },
  tag: { type: 'string' },
  source: { type: 'string' },
  sink: { type: 'string' },
  'flow-id': { type: 'string' },
  'source-rule': { type: 'string' },
  'sink-rule': { type: 'string' },
  format: { type: 'string' },
  json: { type: 'boolean', default: false }
});

const buildRiskExplainFilters = (argv) => normalizeRiskFilters({
  rule: argv.rule,
  category: argv.category,
  severity: argv.severity,
  tag: argv.tag,
  source: argv.source,
  sink: argv.sink,
  flowId: argv['flow-id'],
  sourceRule: argv['source-rule'],
  sinkRule: argv['sink-rule']
});

const buildCliErrorDetails = (canonicalCode, reason = null) => {
  const details = {
    canonicalCode
  };
  if (reason) details.reason = reason;
  return details;
};

export async function buildRiskExplainPayload({
  indexDir,
  chunkUid,
  max = 20,
  filters = null,
  includePartialFlows = false,
  maxPartialFlows = 20
}) {
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

  const targetChunk = chunkByUid.get(chunkUid) || null;
  if (!targetChunk) {
    throw new Error(`Unknown chunkUid: ${chunkUid}`);
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
  const riskPartialFlows = includePartialFlows ? await safeLoadArray('risk_partial_flows') : null;
  const callSites = await safeLoadArray('call_sites');
  const stats = await safeLoadObject('risk_interprocedural_stats');

  const summaryRow = Array.isArray(riskSummaries)
    ? riskSummaries.find((row) => row?.chunkUid === chunkUid)
    : null;

  const summaryFromChunk = targetChunk?.docmeta?.risk?.summary || targetChunk?.metaV2?.risk?.summary || null;
  const summary = summaryFromChunk || summaryRow || null;

  const callSiteById = new Map();
  if (Array.isArray(callSites)) {
    for (const entry of callSites) {
      if (entry?.callSiteId) callSiteById.set(entry.callSiteId, entry);
    }
  }

  const flows = Array.isArray(riskFlows) ? riskFlows : [];
  const relevantFlows = flows.filter((flow) => {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    const isRelevant = flow?.source?.chunkUid === chunkUid
      || flow?.sink?.chunkUid === chunkUid
      || chunkUids.includes(chunkUid);
    return isRelevant;
  });
  const matchingFlows = filterRiskFlows(relevantFlows, filters);

  matchingFlows.sort((a, b) => {
    const confA = Number.isFinite(a?.confidence) ? a.confidence : -1;
    const confB = Number.isFinite(b?.confidence) ? b.confidence : -1;
    if (confA !== confB) return confB - confA;
    const idA = a?.flowId || '';
    const idB = b?.flowId || '';
    return idA.localeCompare(idB);
  });

  const maxFlows = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 20;
  const limitedFlows = matchingFlows.slice(0, maxFlows);
  const maxPartials = Number.isFinite(maxPartialFlows) ? Math.max(1, Math.floor(maxPartialFlows)) : 20;

  const formatChunkLabel = (uid) => {
    const entry = chunkByUid.get(uid) || null;
    const file = resolveChunkFile(entry) || null;
    const symbol = resolveChunkName(entry) || null;
    if (file && symbol) return `${file}::${symbol}`;
    if (file) return file;
    return uid || 'unknown';
  };

  const buildFlowPayload = (flow) => {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    const stepIds = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
    const watchByStep = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
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
      category: flow?.sink?.category || flow?.source?.category || null,
      path: {
        nodes: chunkUids.map((uid) => ({ type: 'chunk', chunkUid: uid })),
        labels: chunkUids.map((uid) => formatChunkLabel(uid)),
        callSiteIdsByStep: stepIds,
        watchByStep: watchByStep.slice(0, stepIds.length).map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
      },
      evidence: {
        callSitesByStep
      }
    };
  };

  const partialFlows = Array.isArray(riskPartialFlows) ? riskPartialFlows : [];
  const relevantPartialFlows = filterRiskPartialFlows(partialFlows.filter((flow) => {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    return flow?.source?.chunkUid === chunkUid
      || flow?.frontier?.chunkUid === chunkUid
      || chunkUids.includes(chunkUid);
  }), filters);
  relevantPartialFlows.sort((a, b) => {
    const confA = Number.isFinite(a?.confidence) ? a.confidence : -1;
    const confB = Number.isFinite(b?.confidence) ? b.confidence : -1;
    if (confA !== confB) return confB - confA;
    const idA = a?.partialFlowId || '';
    const idB = b?.partialFlowId || '';
    return idA.localeCompare(idB);
  });

  const buildPartialFlowPayload = (flow) => {
    const chunkUids = Array.isArray(flow?.path?.chunkUids) ? flow.path.chunkUids : [];
    const stepIds = Array.isArray(flow?.path?.callSiteIdsByStep) ? flow.path.callSiteIdsByStep : [];
    const watchByStep = Array.isArray(flow?.path?.watchByStep) ? flow.path.watchByStep : [];
    const callSitesByStep = stepIds.map((ids) => (ids || []).map((id) => ({
      callSiteId: id,
      details: callSiteById.get(id) || null
    })));
    return {
      partialFlowId: flow?.partialFlowId || null,
      confidence: flow?.confidence ?? null,
      source: flow?.source || null,
      frontier: flow?.frontier || null,
      notes: flow?.notes || null,
      path: {
        nodes: chunkUids.map((uid) => ({ type: 'chunk', chunkUid: uid })),
        labels: chunkUids.map((uid) => formatChunkLabel(uid)),
        callSiteIdsByStep: stepIds,
        watchByStep: watchByStep.slice(0, stepIds.length).map((entry) => (entry && typeof entry === 'object' ? { ...entry } : null))
      },
      evidence: {
        callSitesByStep
      }
    };
  };

  return {
    chunk: {
      chunkUid,
      file: resolveChunkFile(targetChunk),
      name: resolveChunkName(targetChunk),
      kind: resolveChunkKind(targetChunk)
    },
    summary,
    stats: stats || null,
    filters,
    flows: limitedFlows.map(buildFlowPayload),
    partialFlows: includePartialFlows
      ? relevantPartialFlows.slice(0, maxPartials).map(buildPartialFlowPayload)
      : []
  };
}

export async function runRiskExplainCli(rawArgs = process.argv.slice(2)) {
  const argv = createCli({
    scriptName: 'risk explain',
    options: RISK_EXPLAIN_OPTIONS,
    aliases: {
      'include-partial-flows': 'includePartialFlows',
      'max-partial-flows': 'maxPartialFlows'
    }
  }).parse(rawArgs);
  const format = resolveFormat(argv);

  const indexArg = argv.index ? String(argv.index) : '';
  const chunkArg = argv.chunk ? String(argv.chunk) : '';
  if (!indexArg || !chunkArg) {
    if (format === 'md') {
      console.error('Usage: pairofcleats risk explain --index <dir> --chunk <chunkUid> [--max N]');
    }
    return emitCliError({
      format,
      code: 'ERR_INVALID_REQUEST',
      message: 'Missing --index or --chunk.',
      details: buildCliErrorDetails(ERROR_CODES.INVALID_REQUEST, 'missing_required_arguments')
    });
  }

  const indexDir = path.resolve(indexArg);
  if (!fs.existsSync(indexDir)) {
    const message = `Missing index directory: ${indexDir}`;
    if (format === 'md') {
      console.error(message);
    }
    return emitCliError({
      format,
      code: 'ERR_INDEX_DIR_MISSING',
      message,
      details: buildCliErrorDetails(ERROR_CODES.NO_INDEX, 'missing_index_dir')
    });
  }

  const filters = buildRiskExplainFilters(argv);
  const filterValidation = validateRiskFilters(filters);
  if (!filterValidation.ok) {
    const message = `Invalid risk filters: ${filterValidation.errors.join('; ')}`;
    if (format === 'md') {
      console.error(message);
    }
    return emitCliError({
      format,
      code: 'ERR_RISK_FILTERS_INVALID',
      message,
      details: buildCliErrorDetails(ERROR_CODES.INVALID_REQUEST, 'invalid_risk_filters')
    });
  }

  try {
    const output = await buildRiskExplainPayload({
      indexDir,
      chunkUid: chunkArg,
      max: argv.max,
      filters,
      includePartialFlows: argv.includePartialFlows === true,
      maxPartialFlows: argv.maxPartialFlows
    });
    const maxItems = Number.isFinite(argv.max) ? Math.max(1, Math.floor(argv.max)) : 20;
    const maxPartialItems = Number.isFinite(argv.maxPartialFlows) ? Math.max(1, Math.floor(argv.maxPartialFlows)) : 20;
    const presentation = buildRiskExplanationPresentationFromStandalone(output, {
      surface: 'standalone',
      maxFlows: maxItems,
      maxEvidencePerFlow: maxItems,
      maxPartialFlows: maxPartialItems
    });

    if (format === 'md' && !output.flows.length && !output.partialFlows.length) {
      console.log('No interprocedural flows found for this chunk.');
      return { ok: true, payload: output };
    }

    return emitCliOutput({
      format,
      payload: output,
      renderMarkdown: () => presentation.markdown,
      renderJson: () => ({
        ...output,
        rendered: presentation.json
      })
    });
  } catch (err) {
    const message = err?.message || 'Failed to build risk explanation.';
    const details = /Unknown chunkUid/i.test(message)
      ? buildCliErrorDetails(ERROR_CODES.INVALID_REQUEST, 'unknown_chunk_uid')
      : buildCliErrorDetails(ERROR_CODES.INTERNAL);
    const code = /Unknown chunkUid/i.test(message)
      ? 'ERR_INVALID_REQUEST'
      : 'ERR_RISK_EXPLAIN';
    return emitCliError({ format, code, message, details });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runRiskExplainCli();
  if (result?.ok === false) {
    process.exit(1);
  }
}
