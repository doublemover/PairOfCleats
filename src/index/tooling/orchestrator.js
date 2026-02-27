import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { coerceFiniteNumber } from '../../shared/number-coerce.js';
import { selectToolingProviders } from './provider-registry.js';
import { normalizeProviderId } from './provider-contract.js';
import {
  MAX_PARAM_CANDIDATES,
  ensureParamTypeMap,
  mergeTypeEntries,
  normalizeProviderPayload,
  toTypeEntryCollection
} from './provider-output-contract.js';

const mapFromRecord = (record) => {
  if (record instanceof Map) return record;
  if (Array.isArray(record)) {
    return new Map(
      record.filter((entry) => (
        Array.isArray(entry)
        && entry.length >= 2
      )).map((entry) => [entry[0], entry[1]])
    );
  }
  if (record && typeof record !== 'string' && typeof record[Symbol.iterator] === 'function') {
    try {
      return new Map(Array.from(record));
    } catch {}
  }
  const output = new Map();
  for (const [key, value] of Object.entries(record || {})) {
    output.set(key, value);
  }
  return output;
};

const computeDocumentsKey = (documents) => {
  const parts = documents.map((doc) => `${doc.virtualPath}:${doc.docHash}`);
  parts.sort();
  return parts.join(',');
};

const computeTargetsKey = (targets) => {
  const parts = (Array.isArray(targets) ? targets : [])
    .map((target) => String(target?.chunkRef?.chunkUid || target?.chunk?.chunkUid || ''))
    .filter(Boolean);
  parts.sort();
  return parts.join(',');
};

const computeCacheKey = ({ providerId, providerVersion, configHash, documents, targets }) => {
  const docKey = computeDocumentsKey(documents || []);
  const targetKey = computeTargetsKey(targets || []);
  return buildLocalCacheKey({
    namespace: 'tooling-provider',
    payload: {
      providerId,
      providerVersion,
      configHash,
      documents: docKey,
      targets: targetKey
    }
  }).key;
};

const ensureCacheDir = async (dir) => {
  if (!dir) return null;
  await fs.mkdir(dir, { recursive: true });
  return dir;
};

const pruneToolingCacheDir = async (cacheDir, { maxBytes, maxEntries } = {}) => {
  if (!cacheDir) return { removed: 0, remainingBytes: 0 };
  const limitBytes = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  const limitEntries = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0;
  if (!limitBytes && !limitEntries) return { removed: 0, remainingBytes: 0 };
  let entries;
  try {
    entries = await fs.readdir(cacheDir, { withFileTypes: true });
  } catch {
    return { removed: 0, remainingBytes: 0 };
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  const stats = [];
  for (const entry of files) {
    const fullPath = path.join(cacheDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      stats.push({
        path: fullPath,
        size: Number.isFinite(stat.size) ? stat.size : 0,
        mtimeMs: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0
      });
    } catch {}
  }
  stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let remainingBytes = stats.reduce((sum, entry) => sum + entry.size, 0);
  const toRemove = new Set();
  if (limitEntries && stats.length > limitEntries) {
    for (const entry of stats.slice(0, stats.length - limitEntries)) {
      toRemove.add(entry.path);
      remainingBytes -= entry.size;
    }
  }
  if (limitBytes && remainingBytes > limitBytes) {
    for (const entry of stats) {
      if (remainingBytes <= limitBytes) break;
      if (toRemove.has(entry.path)) continue;
      toRemove.add(entry.path);
      remainingBytes -= entry.size;
    }
  }
  for (const target of toRemove) {
    try {
      await fs.rm(target, { force: true });
    } catch {}
  }
  return { removed: toRemove.size, remainingBytes: Math.max(0, remainingBytes) };
};

const normalizeProviderOutputs = ({
  output,
  targetByChunkUid,
  chunkUidByChunkId,
  strict,
  observations,
  providerId
}) => {
  if (!output) return new Map();
  const byChunkUid = new Map();
  const consume = (chunkUid, entry) => {
    if (!chunkUid) {
      if (strict) throw new Error('Provider output missing chunkUid.');
      return;
    }
    const target = targetByChunkUid.get(chunkUid);
    if (!target) {
      if (strict) throw new Error(`Provider output chunkUid unresolved (${chunkUid}).`);
      return;
    }
    const normalized = entry && typeof entry === 'object' ? { ...entry } : {};
    normalized.payload = normalizeProviderPayload(normalized.payload, {
      observations,
      providerId,
      chunkUid,
      maxParamCandidates: MAX_PARAM_CANDIDATES
    });
    if (!normalized.chunk && target?.chunkRef) {
      normalized.chunk = target.chunkRef;
    }
    byChunkUid.set(chunkUid, normalized);
  };
  const consumeMap = (map) => {
    for (const [key, entry] of map.entries()) consume(key, entry);
  };
  if (output.byChunkUid) {
    consumeMap(mapFromRecord(output.byChunkUid));
  }
  if (output.byChunkId) {
    const mapped = mapFromRecord(output.byChunkId);
    for (const [chunkId, entry] of mapped.entries()) {
      const chunkUid = chunkUidByChunkId.get(chunkId);
      if (!chunkUid) {
        if (strict) throw new Error(`Provider output chunkId unresolved (${chunkId}).`);
        continue;
      }
      consume(chunkUid, entry);
    }
  }
  return byChunkUid;
};

const mergePayload = (target, incoming, { observations, chunkUid } = {}) => {
  if (!incoming) return target;
  const payload = target.payload || {};
  const next = normalizeProviderPayload(incoming.payload, {
    observations,
    providerId: 'tooling-provider',
    chunkUid,
    maxParamCandidates: MAX_PARAM_CANDIDATES
  });
  if (next.returnType && !payload.returnType) payload.returnType = next.returnType;
  if (next.signature && !payload.signature) payload.signature = next.signature;
  if (next.paramTypes && typeof next.paramTypes === 'object' && !Array.isArray(next.paramTypes)) {
    const targetParamTypes = ensureParamTypeMap(payload.paramTypes);
    payload.paramTypes = targetParamTypes;
    for (const [name, types] of Object.entries(next.paramTypes)) {
      const incomingEntries = toTypeEntryCollection(types);
      if (!incomingEntries.length) continue;
      const existingEntries = toTypeEntryCollection(targetParamTypes[name]);
      const { list, truncated } = mergeTypeEntries(existingEntries, incomingEntries, MAX_PARAM_CANDIDATES);
      targetParamTypes[name] = list;
      if (truncated && observations && chunkUid) {
        observations.push({
          level: 'warn',
          code: 'tooling_param_types_truncated',
          message: `tooling param types truncated for ${chunkUid}:${name}`,
          context: { chunkUid, param: name, cap: MAX_PARAM_CANDIDATES }
        });
      }
    }
  }
  target.payload = payload;
  return target;
};

const normalizeProvenanceList = (value, { providerId, providerVersion }) => {
  const raw = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? [value] : []);
  const normalized = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const provider = entry.provider ? String(entry.provider) : '';
    const version = entry.version ? String(entry.version) : '';
    normalized.push({
      provider: provider || providerId,
      version: version || providerVersion,
      collectedAt: entry.collectedAt || new Date().toISOString()
    });
  }
  if (normalized.length) return normalized;
  return [{
    provider: providerId,
    version: providerVersion,
    collectedAt: new Date().toISOString()
  }];
};

const summarizeDegradedProviders = ({ providerDiagnostics, sourcesByChunkUid, observations }) => {
  const providerChunkContributions = new Map();
  for (const sourceSet of sourcesByChunkUid.values()) {
    if (!sourceSet || typeof sourceSet[Symbol.iterator] !== 'function') continue;
    for (const providerId of sourceSet) {
      const normalized = normalizeProviderId(providerId);
      if (!normalized) continue;
      providerChunkContributions.set(normalized, (providerChunkContributions.get(normalized) || 0) + 1);
    }
  }
  const degradedProviders = [];
  for (const [providerIdRaw, diag] of Object.entries(providerDiagnostics || {})) {
    const providerId = normalizeProviderId(providerIdRaw);
    if (!providerId) continue;
    const checks = Array.isArray(diag?.checks) ? diag.checks : [];
    const failingChecks = checks.filter((check) => check?.status === 'warn' || check?.status === 'error');
    if (!failingChecks.length) continue;
    const contributedChunks = providerChunkContributions.get(providerId) || 0;
    if (contributedChunks > 0) continue;
    const warningCount = failingChecks.filter((check) => check?.status === 'warn').length;
    const errorCount = failingChecks.filter((check) => check?.status === 'error').length;
    const reasonCodes = Array.from(new Set(
      failingChecks
        .map((check) => String(check?.name || '').trim())
        .filter(Boolean)
    ));
    const entry = {
      providerId,
      warningCount,
      errorCount,
      reasonCodes,
      contributedChunks
    };
    degradedProviders.push(entry);
    observations.push({
      level: errorCount > 0 ? 'error' : 'warn',
      code: 'tooling_provider_degraded_mode',
      message: `[tooling] ${providerId} degraded mode active (fail-open).`,
      context: entry
    });
  }
  degradedProviders.sort((a, b) => a.providerId.localeCompare(b.providerId));
  return degradedProviders;
};

const summarizeProviderRuntime = (runtime) => ({
  capabilities: runtime?.capabilities && typeof runtime.capabilities === 'object'
    ? { ...runtime.capabilities }
    : null,
  requests: {
    requests: coerceFiniteNumber(runtime?.requests?.requests, 0) ?? 0,
    succeeded: coerceFiniteNumber(runtime?.requests?.succeeded, 0) ?? 0,
    failed: coerceFiniteNumber(runtime?.requests?.failed, 0) ?? 0,
    timedOut: coerceFiniteNumber(runtime?.requests?.timedOut, 0) ?? 0,
    latencyMs: {
      count: coerceFiniteNumber(runtime?.requests?.latencyMs?.count, 0) ?? 0,
      p50: coerceFiniteNumber(runtime?.requests?.latencyMs?.p50, 0) ?? 0,
      p95: coerceFiniteNumber(runtime?.requests?.latencyMs?.p95, 0) ?? 0
    }
  },
  lifecycle: {
    startsInWindow: coerceFiniteNumber(runtime?.lifecycle?.startsInWindow, 0) ?? 0,
    crashesInWindow: coerceFiniteNumber(runtime?.lifecycle?.crashesInWindow, 0) ?? 0,
    crashLoopTrips: coerceFiniteNumber(runtime?.lifecycle?.crashLoopTrips, 0) ?? 0,
    crashLoopQuarantined: runtime?.lifecycle?.crashLoopQuarantined === true,
    fdPressureEvents: coerceFiniteNumber(runtime?.lifecycle?.fdPressureEvents, 0) ?? 0,
    fdPressureBackoffActive: runtime?.lifecycle?.fdPressureBackoffActive === true
  },
  guard: {
    breakerThreshold: coerceFiniteNumber(runtime?.guard?.breakerThreshold, 0) ?? 0,
    consecutiveFailures: coerceFiniteNumber(runtime?.guard?.consecutiveFailures, 0) ?? 0,
    tripCount: coerceFiniteNumber(runtime?.guard?.tripCount, 0) ?? 0
  },
  pooling: {
    enabled: runtime?.pooling?.enabled === true,
    reused: runtime?.pooling?.reused === true,
    sessionKeyPresent: Boolean(runtime?.pooling?.sessionKey),
    recycleCount: coerceFiniteNumber(runtime?.pooling?.recycleCount, 0) ?? 0,
    ageMs: coerceFiniteNumber(runtime?.pooling?.ageMs, 0) ?? 0
  },
  hover: {
    requested: coerceFiniteNumber(runtime?.hoverMetrics?.requested, 0) ?? 0,
    succeeded: coerceFiniteNumber(runtime?.hoverMetrics?.succeeded, 0) ?? 0,
    timedOut: coerceFiniteNumber(runtime?.hoverMetrics?.timedOut, 0) ?? 0,
    hoverTimedOut: coerceFiniteNumber(runtime?.hoverMetrics?.hoverTimedOut, 0) ?? 0,
    signatureHelpRequested: coerceFiniteNumber(runtime?.hoverMetrics?.signatureHelpRequested, 0) ?? 0,
    signatureHelpSucceeded: coerceFiniteNumber(runtime?.hoverMetrics?.signatureHelpSucceeded, 0) ?? 0,
    signatureHelpTimedOut: coerceFiniteNumber(runtime?.hoverMetrics?.signatureHelpTimedOut, 0) ?? 0,
    definitionRequested: coerceFiniteNumber(runtime?.hoverMetrics?.definitionRequested, 0) ?? 0,
    definitionSucceeded: coerceFiniteNumber(runtime?.hoverMetrics?.definitionSucceeded, 0) ?? 0,
    definitionTimedOut: coerceFiniteNumber(runtime?.hoverMetrics?.definitionTimedOut, 0) ?? 0,
    typeDefinitionRequested: coerceFiniteNumber(runtime?.hoverMetrics?.typeDefinitionRequested, 0) ?? 0,
    typeDefinitionSucceeded: coerceFiniteNumber(runtime?.hoverMetrics?.typeDefinitionSucceeded, 0) ?? 0,
    typeDefinitionTimedOut: coerceFiniteNumber(runtime?.hoverMetrics?.typeDefinitionTimedOut, 0) ?? 0,
    referencesRequested: coerceFiniteNumber(runtime?.hoverMetrics?.referencesRequested, 0) ?? 0,
    referencesSucceeded: coerceFiniteNumber(runtime?.hoverMetrics?.referencesSucceeded, 0) ?? 0,
    referencesTimedOut: coerceFiniteNumber(runtime?.hoverMetrics?.referencesTimedOut, 0) ?? 0,
    incompleteSymbols: coerceFiniteNumber(runtime?.hoverMetrics?.incompleteSymbols, 0) ?? 0,
    hoverTriggeredByIncomplete: coerceFiniteNumber(runtime?.hoverMetrics?.hoverTriggeredByIncomplete, 0) ?? 0,
    fallbackUsed: coerceFiniteNumber(runtime?.hoverMetrics?.fallbackUsed, 0) ?? 0,
    skippedByBudget: coerceFiniteNumber(runtime?.hoverMetrics?.skippedByBudget, 0) ?? 0,
    skippedByKind: coerceFiniteNumber(runtime?.hoverMetrics?.skippedByKind, 0) ?? 0,
    skippedByReturnSufficient: coerceFiniteNumber(runtime?.hoverMetrics?.skippedByReturnSufficient, 0) ?? 0,
    skippedByAdaptiveDisable: coerceFiniteNumber(runtime?.hoverMetrics?.skippedByAdaptiveDisable, 0) ?? 0,
    skippedByGlobalDisable: coerceFiniteNumber(runtime?.hoverMetrics?.skippedByGlobalDisable, 0) ?? 0
  }
});

/**
 * Build machine-readable provider metrics for observability and CI assertions.
 *
 * Counts intentionally distinguish planned providers, executed providers
 * (diagnostics emitted), and providers that contributed symbols.
 *
 * @param {{
 *   providerPlans:Array<object>,
 *   providerDiagnostics:object,
 *   sourcesByChunkUid:Map<string,Set<string>>,
 *   degradedProviders:Array<object>
 * }} input
 * @returns {object}
 */
const summarizeToolingMetrics = ({
  providerPlans,
  providerDiagnostics,
  sourcesByChunkUid,
  degradedProviders
}) => {
  const uniquePlannedProviderIds = new Set();
  for (const plan of providerPlans || []) {
    const id = normalizeProviderId(plan?.provider?.id);
    if (id) uniquePlannedProviderIds.add(id);
  }
  const providerContributionById = new Map();
  for (const sourceSet of sourcesByChunkUid.values()) {
    if (!sourceSet || typeof sourceSet[Symbol.iterator] !== 'function') continue;
    for (const providerId of sourceSet) {
      const normalized = normalizeProviderId(providerId);
      if (!normalized) continue;
      providerContributionById.set(normalized, (providerContributionById.get(normalized) || 0) + 1);
    }
  }
  const executedProviderIds = Object.keys(providerDiagnostics || {})
    .map((providerId) => normalizeProviderId(providerId))
    .filter(Boolean);
  let degradedWarningChecks = 0;
  let degradedErrorChecks = 0;
  const degradedReasonCodes = new Set();
  const degradedByProviderId = new Map();
  for (const entry of degradedProviders || []) {
    const providerId = normalizeProviderId(entry?.providerId);
    if (providerId) degradedByProviderId.set(providerId, entry);
    degradedWarningChecks += Number(entry?.warningCount) || 0;
    degradedErrorChecks += Number(entry?.errorCount) || 0;
    for (const code of Array.isArray(entry?.reasonCodes) ? entry.reasonCodes : []) {
      const normalized = String(code || '').trim();
      if (normalized) degradedReasonCodes.add(normalized);
    }
  }
  const requestTotals = {
    requests: 0,
    succeeded: 0,
    failed: 0,
    timedOut: 0
  };
  const healthTotals = {
    crashLoopTrips: 0,
    crashLoopQuarantinedProviders: 0,
    fdPressureEvents: 0,
    providersWithFdPressure: 0,
    breakerTripCount: 0,
    providersWithBreakerTrips: 0,
    maxConsecutiveFailures: 0,
    pooledProviders: 0,
    reusedSessionProviders: 0
  };
  const capabilityTotals = {
    providersWithCapabilitiesMask: 0,
    documentSymbol: 0,
    hover: 0,
    signatureHelp: 0,
    definition: 0,
    typeDefinition: 0,
    references: 0
  };
  const hoverTotals = {
    requested: 0,
    succeeded: 0,
    timedOut: 0,
    hoverTimedOut: 0,
    signatureHelpRequested: 0,
    signatureHelpSucceeded: 0,
    signatureHelpTimedOut: 0,
    definitionRequested: 0,
    definitionSucceeded: 0,
    definitionTimedOut: 0,
    typeDefinitionRequested: 0,
    typeDefinitionSucceeded: 0,
    typeDefinitionTimedOut: 0,
    referencesRequested: 0,
    referencesSucceeded: 0,
    referencesTimedOut: 0,
    incompleteSymbols: 0,
    hoverTriggeredByIncomplete: 0,
    fallbackUsed: 0,
    skippedByBudget: 0,
    skippedByKind: 0,
    skippedByReturnSufficient: 0,
    skippedByAdaptiveDisable: 0,
    skippedByGlobalDisable: 0,
    providersWithActivity: 0
  };
  const providerRuntime = Object.create(null);
  const sortedExecutedProviderIds = Array.from(new Set(executedProviderIds)).sort((a, b) => a.localeCompare(b));
  for (const providerId of sortedExecutedProviderIds) {
    const diagnostics = providerDiagnostics?.[providerId] || null;
    const runtime = summarizeProviderRuntime(diagnostics?.runtime || null);
    const degraded = degradedByProviderId.get(providerId) || null;
    providerRuntime[providerId] = {
      ...runtime,
      degraded: {
        active: Boolean(degraded),
        warningCount: Number(degraded?.warningCount) || 0,
        errorCount: Number(degraded?.errorCount) || 0,
        reasonCodes: Array.isArray(degraded?.reasonCodes) ? degraded.reasonCodes.slice() : []
      }
    };
    requestTotals.requests += runtime.requests.requests;
    requestTotals.succeeded += runtime.requests.succeeded;
    requestTotals.failed += runtime.requests.failed;
    requestTotals.timedOut += runtime.requests.timedOut;
    healthTotals.crashLoopTrips += runtime.lifecycle.crashLoopTrips;
    if (runtime.lifecycle.crashLoopQuarantined) healthTotals.crashLoopQuarantinedProviders += 1;
    healthTotals.fdPressureEvents += runtime.lifecycle.fdPressureEvents;
    if (runtime.lifecycle.fdPressureEvents > 0 || runtime.lifecycle.fdPressureBackoffActive) {
      healthTotals.providersWithFdPressure += 1;
    }
    healthTotals.breakerTripCount += runtime.guard.tripCount;
    if (runtime.guard.tripCount > 0) healthTotals.providersWithBreakerTrips += 1;
    healthTotals.maxConsecutiveFailures = Math.max(
      healthTotals.maxConsecutiveFailures,
      runtime.guard.consecutiveFailures
    );
    if (runtime.pooling.enabled) healthTotals.pooledProviders += 1;
    if (runtime.pooling.reused) healthTotals.reusedSessionProviders += 1;
    hoverTotals.requested += runtime.hover.requested;
    hoverTotals.succeeded += runtime.hover.succeeded;
    hoverTotals.timedOut += runtime.hover.timedOut;
    hoverTotals.hoverTimedOut += runtime.hover.hoverTimedOut;
    hoverTotals.signatureHelpRequested += runtime.hover.signatureHelpRequested;
    hoverTotals.signatureHelpSucceeded += runtime.hover.signatureHelpSucceeded;
    hoverTotals.signatureHelpTimedOut += runtime.hover.signatureHelpTimedOut;
    hoverTotals.definitionRequested += runtime.hover.definitionRequested;
    hoverTotals.definitionSucceeded += runtime.hover.definitionSucceeded;
    hoverTotals.definitionTimedOut += runtime.hover.definitionTimedOut;
    hoverTotals.typeDefinitionRequested += runtime.hover.typeDefinitionRequested;
    hoverTotals.typeDefinitionSucceeded += runtime.hover.typeDefinitionSucceeded;
    hoverTotals.typeDefinitionTimedOut += runtime.hover.typeDefinitionTimedOut;
    hoverTotals.referencesRequested += runtime.hover.referencesRequested;
    hoverTotals.referencesSucceeded += runtime.hover.referencesSucceeded;
    hoverTotals.referencesTimedOut += runtime.hover.referencesTimedOut;
    hoverTotals.incompleteSymbols += runtime.hover.incompleteSymbols;
    hoverTotals.hoverTriggeredByIncomplete += runtime.hover.hoverTriggeredByIncomplete;
    hoverTotals.fallbackUsed += runtime.hover.fallbackUsed;
    hoverTotals.skippedByBudget += runtime.hover.skippedByBudget;
    hoverTotals.skippedByKind += runtime.hover.skippedByKind;
    hoverTotals.skippedByReturnSufficient += runtime.hover.skippedByReturnSufficient;
    hoverTotals.skippedByAdaptiveDisable += runtime.hover.skippedByAdaptiveDisable;
    hoverTotals.skippedByGlobalDisable += runtime.hover.skippedByGlobalDisable;
    if (
      runtime.hover.requested > 0
      || runtime.hover.timedOut > 0
      || runtime.hover.fallbackUsed > 0
      || runtime.hover.signatureHelpRequested > 0
      || runtime.hover.definitionRequested > 0
      || runtime.hover.typeDefinitionRequested > 0
      || runtime.hover.referencesRequested > 0
    ) {
      hoverTotals.providersWithActivity += 1;
    }
    if (runtime.capabilities && typeof runtime.capabilities === 'object') {
      capabilityTotals.providersWithCapabilitiesMask += 1;
      if (runtime.capabilities.documentSymbol === true) capabilityTotals.documentSymbol += 1;
      if (runtime.capabilities.hover === true) capabilityTotals.hover += 1;
      if (runtime.capabilities.signatureHelp === true) capabilityTotals.signatureHelp += 1;
      if (runtime.capabilities.definition === true) capabilityTotals.definition += 1;
      if (runtime.capabilities.typeDefinition === true) capabilityTotals.typeDefinition += 1;
      if (runtime.capabilities.references === true) capabilityTotals.references += 1;
    }
  }
  return {
    providersPlanned: uniquePlannedProviderIds.size,
    providersExecuted: sortedExecutedProviderIds.length,
    providersContributed: providerContributionById.size,
    degradedProviderCount: Array.isArray(degradedProviders) ? degradedProviders.length : 0,
    degradedWarningChecks,
    degradedErrorChecks,
    degradedReasonCodeCount: degradedReasonCodes.size,
    requests: requestTotals,
    health: healthTotals,
    hover: hoverTotals,
    capabilities: capabilityTotals,
    providerRuntime
  };
};

export async function runToolingProviders(ctx, inputs, providerIds = null) {
  const strict = ctx?.strict !== false;
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  const targetByChunkUid = new Map();
  const chunkUidByChunkId = new Map();

  const registerChunkId = (chunkId, chunkUid) => {
    if (!chunkId || !chunkUid) return;
    const existing = chunkUidByChunkId.get(chunkId);
    if (existing && existing !== chunkUid) {
      if (strict) throw new Error(`chunkId collision (${chunkId}) maps to multiple chunkUid values.`);
      return;
    }
    chunkUidByChunkId.set(chunkId, chunkUid);
  };

  for (const target of targets) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    if (!chunkRef || !chunkRef.chunkUid) {
      if (strict) throw new Error('Tooling target missing chunkUid.');
      continue;
    }
    targetByChunkUid.set(chunkRef.chunkUid, target);
    registerChunkId(chunkRef.chunkId, chunkRef.chunkUid);
  }

  const providerPlans = selectToolingProviders({
    toolingConfig: ctx?.toolingConfig || {},
    documents,
    targets,
    providerIds,
    kinds: inputs?.kinds || null
  });

  const merged = new Map();
  const sourcesByChunkUid = new Map();
  const providerDiagnostics = {};
  const observations = [];
  const cacheDir = ctx?.cache?.enabled ? await ensureCacheDir(ctx.cache.dir) : null;

  for (const plan of providerPlans) {
    const provider = plan.provider;
    const providerId = normalizeProviderId(provider?.id);
    if (!providerId) continue;
    const planDocuments = Array.isArray(plan.documents) ? plan.documents : [];
    const planTargets = Array.isArray(plan.targets) ? plan.targets : [];
    const configHash = provider.getConfigHash(ctx);
    const cacheKey = computeCacheKey({
      providerId,
      providerVersion: provider.version,
      configHash,
      documents: planDocuments,
      targets: planTargets
    });
    const cachePath = cacheDir ? path.join(cacheDir, `${providerId}-${cacheKey}.json`) : null;
    let output = null;
    if (cachePath) {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        if (cached?.provider?.id === providerId
          && cached?.provider?.version === provider.version
          && cached?.provider?.configHash === configHash) {
          output = cached;
        }
      } catch {}
    }
    if (!output) {
      const providerInputs = {
        ...inputs,
        documents: planDocuments,
        targets: planTargets
      };
      output = await provider.run(ctx, providerInputs);
      if (output) {
        output.provider = {
          id: providerId,
          version: provider.version,
          configHash
        };
      }
      if (cachePath && output) {
        try {
          await atomicWriteJson(cachePath, output, { spaces: 2 });
        } catch {}
      }
    }
    if (!output) continue;
    providerDiagnostics[providerId] = output.diagnostics || null;
    const normalized = normalizeProviderOutputs({
      output,
      targetByChunkUid,
      chunkUidByChunkId,
      strict,
      observations,
      providerId
    });
    for (const [chunkUid, entry] of normalized.entries()) {
      const existing = merged.get(chunkUid) || {
        chunk: entry?.chunk || targetByChunkUid.get(chunkUid)?.chunkRef || null,
        payload: {},
        provenance: []
      };
      mergePayload(existing, entry, { observations, chunkUid });
      if (entry?.symbolRef && !existing.symbolRef) {
        existing.symbolRef = entry.symbolRef;
      }
      const provenanceEntries = normalizeProvenanceList(entry?.provenance, {
        providerId,
        providerVersion: provider.version
      });
      existing.provenance = Array.isArray(existing.provenance)
        ? [...existing.provenance, ...provenanceEntries]
        : provenanceEntries;
      merged.set(chunkUid, existing);
      const sources = sourcesByChunkUid.get(chunkUid) || new Set();
      sources.add(providerId);
      sourcesByChunkUid.set(chunkUid, sources);
    }
  }

  if (cacheDir) {
    await pruneToolingCacheDir(cacheDir, {
      maxBytes: ctx?.cache?.maxBytes,
      maxEntries: ctx?.cache?.maxEntries
    });
  }

  const degradedProviders = summarizeDegradedProviders({
    providerDiagnostics,
    sourcesByChunkUid,
    observations
  });
  const metrics = summarizeToolingMetrics({
    providerPlans,
    providerDiagnostics,
    sourcesByChunkUid,
    degradedProviders
  });

  return {
    byChunkUid: merged,
    sourcesByChunkUid,
    diagnostics: providerDiagnostics,
    observations,
    degradedProviders,
    metrics
  };
}
