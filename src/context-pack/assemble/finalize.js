import { normalizeLimit, normalizeOptionalNumber } from '../../shared/limits.js';
import {
  buildProcessMemoryPeak,
  snapshotProcessMemory
} from '../../shared/ops/resource-visibility.js';
import { resolveProvenance } from '../../shared/provenance.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../shared/risk-filters.js';
import { createTruncationRecorder } from '../../shared/truncation.js';
import { MAX_JSON_BYTES } from '../../shared/artifact-io/constants.js';
import { loadPiecesManifest } from '../../shared/artifact-io/manifest.js';
import { loadChunkMeta } from '../../shared/artifact-io/loaders/chunk-meta.js';
import { buildGraphContextPack } from '../../graph/context-pack.js';
import {
  buildChunkIndex,
  buildChunkUidMapSeedIndex,
  resolveChunkBySeed,
  resolveChunkCandidatesBySeed,
  resolveChunkUidMapSeedCandidatesFromIndex,
  resolveChunkUidMapSeedRefs,
  resolvePrimaryRef,
  resolveSeedRef
} from '../seed-resolution.js';
import {
  buildTypeFactsEvidence,
  buildPrimaryExcerpt,
  normalizeTypeFacts
} from '../excerpt-cache.js';
import { buildRiskSlice } from './risk-slice.js';
import { buildTaskPrimaryExcerpt, resolveContextTaskPolicy } from '../task-policy.js';
import { throwIfAborted } from '../../shared/abort.js';

const buildGraphFilters = ({ includeCallersCallees, includeUsages, includeImports }) => {
  const graphs = [];
  if (includeCallersCallees) graphs.push('callGraph');
  if (includeUsages) graphs.push('usageGraph');
  if (includeImports) graphs.push('importGraph');
  return { graphs };
};

export const assembleCompositeContextPack = ({
  seed = null,
  chunkMeta = null,
  chunkIndex = null,
  repoRoot = process.cwd(),
  graphRelations = null,
  symbolEdges = null,
  callSites = null,
  graphIndex = null,
  includeGraph = true,
  includeTypes = false,
  includeRisk = false,
  includeRiskPartialFlows = false,
  riskStrict = false,
  strictEvidence = false,
  taskPolicy = undefined,
  signal = null,
  riskFilters = null,
  includeImports = true,
  includeUsages = true,
  includeCallersCallees = true,
  includePaths = false,
  pathSemantics = undefined,
  depth = 1,
  maxBytes = null,
  maxTokens = null,
  maxTypeEntries = null,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  throwIfAborted(signal);
  taskPolicy = resolveContextTaskPolicy(taskPolicy);
  const timingStart = process.hrtime.bigint();
  const checkDeadline = () => {
    throwIfAborted(signal);
    if (taskPolicy?.task === 'edit-safe' && caps.maxWallClockMs != null
      && Number(process.hrtime.bigint() - timingStart) / 1000000 >= caps.maxWallClockMs) {
      throw Object.assign(new Error('The mandatory complete edit unit exceeded the context work deadline.'),
        { code: 'ERR_CONTEXT_PACK_UNIT_DEADLINE', status: 408 });
    }
  };
  checkDeadline();
  const memoryStart = process.memoryUsage();
  const warnings = [];
  const truncationRecorder = createTruncationRecorder();
  const truncation = truncationRecorder.list;
  const seedRef = resolveSeedRef(seed);
  const normalizedRiskFilters = normalizeRiskFilters(riskFilters);
  const riskFilterValidation = validateRiskFilters(normalizedRiskFilters);
  if (!riskFilterValidation.ok) {
    const error = new Error(`Invalid risk filters: ${riskFilterValidation.errors.join('; ')}`);
    error.code = 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID';
    throw error;
  }
  const resolvedChunkIndex = chunkIndex || buildChunkIndex(chunkMeta);
  const primaryChunk = resolveChunkBySeed(seedRef, resolvedChunkIndex, warnings);
  const primaryRef = resolvePrimaryRef(seedRef, primaryChunk);

  const primary = {
    ref: primaryRef,
    file: null,
    range: null,
    excerpt: '',
    excerptHash: null,
    provenance: null
  };
  const excerptInput = {
    chunk: primaryChunk,
    repoRoot,
    maxBytes: maxBytes == null ? null : normalizeOptionalNumber(maxBytes),
    maxTokens: maxTokens == null ? null : normalizeOptionalNumber(maxTokens),
    indexSignature,
    warnings, taskPolicy, seed: seedRef, signal
  };
  const excerptPayload = taskPolicy?.task === 'edit-safe' ? buildTaskPrimaryExcerpt(excerptInput) : buildPrimaryExcerpt(excerptInput);
  checkDeadline();
  primary.file = excerptPayload.file;
  primary.range = excerptPayload.range;
  primary.excerpt = excerptPayload.excerpt;
  primary.excerptHash = excerptPayload.excerptHash;
  primary.evidence = excerptPayload.evidence || null;
  if (excerptPayload.unit) primary.unit = excerptPayload.unit;
  const excerptBytes = primary.excerpt ? Buffer.byteLength(primary.excerpt, 'utf8') : 0;

  let graph = null;
  if (includeGraph && primaryRef) {
    graph = buildGraphContextPack({
      seed: primaryRef,
      graphRelations,
      symbolEdges,
      callSites,
      graphIndex,
      direction: 'both',
      depth: normalizeLimit(depth, 1),
      edgeFilters: buildGraphFilters({ includeCallersCallees, includeUsages, includeImports }),
      caps,
      includePaths,
      pathSemantics,
      signal,
      indexSignature,
      indexCompatKey,
      repo,
      indexDir,
      now
    });
    if (Array.isArray(graph?.warnings)) warnings.push(...graph.warnings);
    if (Array.isArray(graph?.truncation)) truncation.push(...graph.truncation);
  } else if (includeGraph) {
    warnings.push({ code: 'MISSING_GRAPH', message: 'Graph slice omitted due to missing seed.' });
  }

  let types = null;
  let typeFacts = [];
  if (includeTypes) {
    const warningCountBeforeTypes = warnings.length;
    typeFacts = normalizeTypeFacts(primaryRef || seedRef, primaryChunk, maxTypeEntries, warnings);
    types = {
      facts: typeFacts
    };
    types.evidence = buildTypeFactsEvidence({
      includeTypes: true,
      facts: typeFacts,
      warnings: warnings.slice(warningCountBeforeTypes)
    });
  }

  let risk = null;
  if (includeRisk) {
    risk = buildRiskSlice({
      indexDir,
      repoRoot,
      seedRef,
      primaryChunk,
      chunkIndex: resolvedChunkIndex,
      graphIndex,
      includeRiskPartialFlows,
      riskFilters: normalizedRiskFilters,
      indexSignature,
      indexCompatKey,
      warnings,
      truncation
    });
    if (riskStrict && risk?.analysisStatus?.strictFailure) {
      const err = new Error(`Risk slice strict failure: ${risk.analysisStatus.code || risk.status || 'unknown'}`);
      err.code = 'ERR_CONTEXT_PACK_RISK_STRICT';
      err.risk = {
        status: risk.status || null,
        code: risk.analysisStatus.code || null,
        reason: risk.reason || null
      };
      throw err;
    }
  }

  const provenanceResolved = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed: {
      graph: { ...caps },
      types: Number.isFinite(maxTypeEntries) ? { maxTypeEntries } : {}
    },
    repo,
    indexDir,
    now,
    label: 'CompositeContextPack'
  });

  const memoryEnd = process.memoryUsage();
  const peakMemory = buildProcessMemoryPeak(memoryStart, memoryEnd);
  const elapsedMs = Number((process.hrtime.bigint() - timingStart) / 1000000n);
  const evidence = {
    schemaVersion: 2,
    policy: {
      strictEvidence: strictEvidence === true,
      ...(taskPolicy ? { taskPolicy } : {})
    },
    primary: excerptPayload.evidence || {
      state: 'missing',
      source: 'missing',
      fileBacked: false,
      substituted: false,
      missing: true,
      truncated: false,
      truncatedBytes: false,
      truncatedTokens: false,
      warningCodes: []
    },
    types: types?.evidence || buildTypeFactsEvidence({
      includeTypes,
      facts: typeFacts,
      warnings: []
    })
  };
  evidence.complete = evidence.primary.state === 'file-backed'
    && evidence.primary.sourceIdentity?.drift === 'unchanged'
    && evidence.primary.truncated !== true
    && (includeTypes !== true || evidence.types.state === 'complete');
  if (strictEvidence === true && evidence.complete !== true) {
    const err = new Error('Context-pack strict evidence policy rejected incomplete evidence.');
    err.code = 'ERR_CONTEXT_PACK_STRICT_EVIDENCE';
    err.evidence = evidence;
    throw err;
  }

  checkDeadline();
  return {
    version: '1.0.0',
    seed: primaryRef || seedRef || { v: 1, status: 'unresolved', candidates: [], resolved: null },
    provenance: provenanceResolved,
    primary,
    graph,
    types,
    risk,
    evidence,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null,
    stats: {
      timing: { elapsedMs },
      memory: {
        start: snapshotProcessMemory(memoryStart),
        end: snapshotProcessMemory(memoryEnd),
        peak: peakMemory
      },
      excerptBytes
    }
  };
};

export const assembleCompositeContextPackStreaming = async ({
  seed = null,
  chunkMeta = null,
  chunkIndex = null,
  repoRoot = process.cwd(),
  indexDir = null,
  manifest = null,
  strict = true,
  ...rest
} = {}) => {
  rest = { ...rest, taskPolicy: resolveContextTaskPolicy(rest.taskPolicy) };
  if (chunkMeta || chunkIndex) {
    return assembleCompositeContextPack({ seed, chunkMeta, chunkIndex, repoRoot, indexDir, ...rest });
  }
  if (!indexDir) {
    return assembleCompositeContextPack({ seed, chunkMeta: null, chunkIndex: null, repoRoot, indexDir, ...rest });
  }
  const resolvedManifest = manifest || loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict });
  if (rest.taskPolicy?.task === 'edit-safe') {
    throwIfAborted(rest.signal);
    const full = await loadChunkMeta(indexDir, { manifest: resolvedManifest, strict, maxBytes: MAX_JSON_BYTES });
    throwIfAborted(rest.signal);
    return assembleCompositeContextPack({ seed, chunkMeta: full, repoRoot, indexDir, ...rest });
  }
  const seedRef = resolveSeedRef(seed);
  const candidates = resolveChunkUidMapSeedRefs(seedRef);
  const hasSymbolSeed = candidates.some(candidate => candidate.type === 'symbol');
  const needsCompactIndex = candidates.some(candidate => candidate.type === 'chunk' || candidate.type === 'file');
  const seedIndex = needsCompactIndex
    ? await buildChunkUidMapSeedIndex({
      indexDir,
      manifest: resolvedManifest,
      strict,
      repoRoot
    })
    : null;
  const resolvedChunks = [];
  const seenChunkUids = new Set();
  if (hasSymbolSeed) {
    // Compact UID maps carry no symbol lookup. Hydrate selected-generation
    // metadata explicitly rather than interpreting a symbol's path as a file seed.
    const full = await loadChunkMeta(indexDir, { manifest: resolvedManifest, strict, maxBytes: MAX_JSON_BYTES });
    for (const candidate of resolveChunkCandidatesBySeed(seedRef, buildChunkIndex(full, { repoRoot }))) {
      if (!candidate.chunkUid || seenChunkUids.has(candidate.chunkUid)) continue;
      seenChunkUids.add(candidate.chunkUid);
      resolvedChunks.push(candidate.chunk);
    }
  }
  for (const candidate of candidates) {
    const chunks = resolveChunkUidMapSeedCandidatesFromIndex({
      seedIndex,
      seedRef: candidate,
      repoRoot
    });
    for (const chunk of chunks) {
      const chunkUid = chunk?.chunkUid || null;
      if (!chunkUid || seenChunkUids.has(chunkUid)) continue;
      seenChunkUids.add(chunkUid);
      resolvedChunks.push(chunk);
    }
  }
  const chunkMetaResolved = resolvedChunks.length ? resolvedChunks : null;
  const chunkIndexResolved = chunkMetaResolved ? buildChunkIndex(chunkMetaResolved, { repoRoot }) : null;
  const payload = assembleCompositeContextPack({
    seed,
    chunkMeta: chunkMetaResolved,
    chunkIndex: chunkIndexResolved,
    repoRoot,
    indexDir,
    ...rest
  });
  if (!resolvedChunks.length && payload) {
    const warning = seedIndex?.degradation ? { code: 'CHUNK_UID_MAP_UNAVAILABLE', ...seedIndex.degradation,
      message: 'Optional chunk_uid_map is undeclared; compact seed resolution is unavailable.' }
      : { code: 'CHUNK_UID_MAP_MISS', message: 'chunk_uid_map could not resolve seed to chunk metadata; excerpt may be incomplete.' };
    payload.warnings = [...(payload.warnings || []), warning];
  }
  if (payload?.stats) {
    payload.stats.seedResolution = {
      strategy: hasSymbolSeed ? 'symbol_metadata_fallback' : 'chunk_uid_map_index',
      candidates: candidates.length,
      rowsIndexed: seedIndex?.rowsIndexed || 0,
      readState: seedIndex?.readState || 'not-requested',
      hit: resolvedChunks.length > 0
    };
  }
  return payload;
};

/** Include optional semantic evidence without promoting incomplete analysis. */
export const attachSemanticContextSection = (payload, semantic) => ({
  ...payload, semantic,
  evidence: { ...payload.evidence, semantic: { included: true, state: semantic.status }, complete: false }
});
