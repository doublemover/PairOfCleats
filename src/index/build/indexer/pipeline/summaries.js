export const countFieldEntries = (fieldMaps) => {
  if (!fieldMaps || typeof fieldMaps !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldMaps)) {
    if (entry && typeof entry.size === 'number') total += entry.size;
  }
  return total;
};

export const countFieldArrayEntries = (fieldArrays) => {
  if (!fieldArrays || typeof fieldArrays !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldArrays)) {
    if (Array.isArray(entry)) total += entry.length;
  }
  return total;
};

/**
 * Normalize import-scan aggregate counters for telemetry payloads.
 *
 * @param {object|null} importResult
 * @returns {{modules:number,edges:number,files:number}}
 */
export const summarizeImportStats = (importResult) => {
  if (!importResult?.stats) {
    return { modules: 0, edges: 0, files: 0 };
  }
  return {
    modules: Number(importResult.stats.modules) || 0,
    edges: Number(importResult.stats.edges) || 0,
    files: Number(importResult.stats.files) || 0
  };
};

/**
 * Normalize import-graph cache reuse counters.
 *
 * @param {object|null} importResult
 * @returns {object|null}
 */
export const summarizeImportGraphCacheStats = (importResult) => {
  if (!importResult?.cacheStats) return null;
  const files = Number(importResult.cacheStats.files) || 0;
  const filesReused = Number(importResult.cacheStats.filesReused) || 0;
  return {
    files,
    filesHashed: Number(importResult.cacheStats.filesHashed) || 0,
    filesReused,
    filesInvalidated: Number(importResult.cacheStats.filesInvalidated) || 0,
    specs: Number(importResult.cacheStats.specs) || 0,
    specsReused: Number(importResult.cacheStats.specsReused) || 0,
    specsComputed: Number(importResult.cacheStats.specsComputed) || 0,
    packageInvalidated: importResult.cacheStats.packageInvalidated === true,
    reuseRatio: files ? filesReused / Number(importResult.cacheStats.files || 1) : 0
  };
};

/**
 * Normalize import resolution graph statistics from state.
 *
 * @param {object|null} state
 * @returns {object|null}
 */
export const summarizeImportGraphStats = (state) => {
  const stats = state?.importResolutionGraph?.stats;
  if (!stats) return null;
  return {
    files: Number(stats.files) || 0,
    nodes: Number(stats.nodes) || 0,
    edges: Number(stats.edges) || 0,
    resolved: Number(stats.resolved) || 0,
    external: Number(stats.external) || 0,
    unresolved: Number(stats.unresolved) || 0,
    unresolvedObserved: Number(stats.unresolvedObserved) || 0,
    unresolvedActionable: Number(stats.unresolvedActionable) || 0,
    unresolvedSuppressed: Number(stats.unresolvedSuppressed) || 0,
    unresolvedResolverSuppressed: Number(stats.unresolvedResolverSuppressed) || 0,
    unresolvedLiveSuppressed: Number(stats.unresolvedLiveSuppressed) || 0,
    unresolvedGateSuppressed: Number(stats.unresolvedGateSuppressed) || 0,
    unresolvedByReasonCode: stats.unresolvedByReasonCode || null,
    unresolvedByFailureCause: stats.unresolvedByFailureCause || null,
    unresolvedByDisposition: stats.unresolvedByDisposition || null,
    unresolvedByResolverStage: stats.unresolvedByResolverStage || null,
    unresolvedActionableHotspots: Array.isArray(stats.unresolvedActionableHotspots)
      ? stats.unresolvedActionableHotspots
      : null,
    truncatedEdges: Number(stats.truncatedEdges) || 0,
    truncatedNodes: Number(stats.truncatedNodes) || 0,
    warningSuppressed: Number(stats.warningSuppressed) || 0
  };
};

/**
 * Normalize VFS manifest write stats from stage state.
 *
 * @param {object|null} state
 * @returns {object|null}
 */
export const summarizeVfsManifestStats = (state) => {
  const vfsStats = state?.vfsManifestStats || state?.vfsManifestCollector?.stats || null;
  if (!vfsStats) return null;
  return {
    rows: vfsStats.totalRecords || 0,
    bytes: vfsStats.totalBytes || 0,
    maxLineBytes: vfsStats.maxLineBytes || 0,
    trimmedRows: vfsStats.trimmedRows || 0,
    droppedRows: vfsStats.droppedRows || 0,
    runsSpilled: vfsStats.runsSpilled || 0
  };
};

/**
 * Normalize tiny-repo fast-path status for diagnostics.
 *
 * @param {object|null} tinyRepoFastPath
 * @returns {object|null}
 */
export const summarizeTinyRepoFastPath = (tinyRepoFastPath) => (
  tinyRepoFastPath?.active === true
    ? {
      active: true,
      estimatedLines: tinyRepoFastPath.estimatedLines,
      totalBytes: tinyRepoFastPath.totalBytes,
      fileCount: tinyRepoFastPath.fileCount,
      disableImportGraph: tinyRepoFastPath.disableImportGraph,
      disableCrossFileInference: tinyRepoFastPath.disableCrossFileInference,
      minimalArtifacts: tinyRepoFastPath.minimalArtifacts
    }
    : null
);

export const summarizeGraphRelations = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  const summarize = (graph) => ({
    nodes: Number.isFinite(graph?.nodeCount) ? graph.nodeCount : 0,
    edges: Number.isFinite(graph?.edgeCount) ? graph.edgeCount : 0
  });
  return {
    callGraph: summarize(graphRelations.callGraph),
    usageGraph: summarize(graphRelations.usageGraph),
    importGraph: summarize(graphRelations.importGraph)
  };
};

export const summarizeDocumentExtractionForMode = (state, documentExtractionConfig = null) => {
  const fileInfoByPath = state?.fileInfoByPath;
  if (!(fileInfoByPath && typeof fileInfoByPath.entries === 'function')) return null;
  const policy = buildDocumentExtractionPolicySummary(documentExtractionConfig);
  const files = [];
  const extractorMap = new Map();
  const totals = {
    files: 0,
    pages: 0,
    paragraphs: 0,
    units: 0
  };
  const counts = {
    total: 0,
    ok: 0,
    skipped: 0,
    byReason: {},
    bySourceType: {
      pdf: { total: 0, ok: 0, skipped: 0 },
      docx: { total: 0, ok: 0, skipped: 0 }
    }
  };
  for (const [file, info] of fileInfoByPath.entries()) {
    const extraction = info?.extraction;
    if (!extraction || extraction.status !== 'ok') continue;
    const extractorName = extraction?.extractor?.name || null;
    const extractorVersion = extraction?.extractor?.version || null;
    const extractorTarget = extraction?.extractor?.target || null;
    const extractorKey = `${extractorName || 'unknown'}|${extractorVersion || 'unknown'}|${extractorTarget || ''}`;
    if (!extractorMap.has(extractorKey)) {
      extractorMap.set(extractorKey, {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      });
    }
    const unitCounts = {
      pages: Number(extraction?.counts?.pages) || 0,
      paragraphs: Number(extraction?.counts?.paragraphs) || 0,
      totalUnits: Number(extraction?.counts?.totalUnits) || 0
    };
    totals.files += 1;
    totals.pages += unitCounts.pages;
    totals.paragraphs += unitCounts.paragraphs;
    totals.units += unitCounts.totalUnits;
    counts.total += 1;
    counts.ok += 1;
    if (extraction.sourceType === 'pdf' || extraction.sourceType === 'docx') {
      counts.bySourceType[extraction.sourceType].total += 1;
      counts.bySourceType[extraction.sourceType].ok += 1;
    }
    files.push({
      file,
      status: 'ok',
      reason: null,
      sourceType: extraction.sourceType || null,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      },
      sourceBytesHash: extraction.sourceBytesHash || null,
      sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
      unitCounts,
      normalizationPolicy: extraction.normalizationPolicy || null,
      policy: extraction.policy || policy,
      fidelity: extraction.fidelity || buildDocumentExtractionFidelity({
        sourceType: extraction.sourceType || null,
        status: 'ok',
        warnings: extraction.warnings || [],
        policy
      })
    });
  }
  for (const skipped of state?.skippedFiles || []) {
    const sourceType = skipped?.sourceType === 'docx' ? 'docx' : skipped?.sourceType === 'pdf' ? 'pdf' : null;
    if (!sourceType) continue;
    const file = skipped?.file;
    if (!file || files.some((entry) => entry.file === file && entry.status === 'ok')) continue;
    const reasonRaw = String(skipped?.reason || 'extract_failed');
    const reason = DOCUMENT_EXTRACTION_REASON_SET.has(reasonRaw) ? reasonRaw : 'extract_failed';
    counts.total += 1;
    counts.skipped += 1;
    counts.byReason[reason] = (counts.byReason[reason] || 0) + 1;
    counts.bySourceType[sourceType].total += 1;
    counts.bySourceType[sourceType].skipped += 1;
    files.push({
      file,
      status: 'skipped',
      reason,
      sourceType,
      extractor: null,
      sourceBytesHash: null,
      sourceBytesHashAlgo: null,
      unitCounts: null,
      normalizationPolicy: null,
      policy,
      fidelity: buildDocumentExtractionFidelity({
        sourceType,
        status: 'skipped',
        reason,
        warnings: skipped?.warnings || [],
        policy
      })
    });
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) return null;
  const extractors = Array.from(extractorMap.values()).sort((a, b) => {
    const left = `${a.name || ''}|${a.version || ''}|${a.target || ''}`;
    const right = `${b.name || ''}|${b.version || ''}|${b.target || ''}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    schemaVersion: 2,
    policy,
    coverage: {
      state: counts.total === 0
        ? 'missing'
        : counts.skipped === 0
          ? 'complete'
          : counts.ok > 0
            ? 'partial'
            : 'missing',
      coverageLossCount: counts.skipped,
      qualitySensitiveFailures: policy.qualitySensitive ? counts.skipped : 0,
      bySourceType: counts.bySourceType
    },
    counts,
    files,
    extractors,
    totals
  };
};

export const summarizePostingsQueue = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  return {
    limits: stats.limits || null,
    highWater: stats.highWater || null,
    backpressure: stats.backpressure || null,
    oversize: stats.oversize || null,
    memory: stats.memory || null
  };
};
import {
  buildDocumentExtractionFidelity,
  buildDocumentExtractionPolicySummary,
  DOCUMENT_EXTRACTION_REASON_CODES
} from '../../../extractors/common.js';

const DOCUMENT_EXTRACTION_REASON_SET = new Set(DOCUMENT_EXTRACTION_REASON_CODES);
