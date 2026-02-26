import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLocalCacheKey } from '../../shared/cache-key.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { selectToolingProviders } from './provider-registry.js';
import { normalizeProviderId } from './provider-contract.js';

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

const computeCacheKey = ({ providerId, providerVersion, configHash, documents }) => {
  const docKey = computeDocumentsKey(documents || []);
  return buildLocalCacheKey({
    namespace: 'tooling-provider',
    payload: {
      providerId,
      providerVersion,
      configHash,
      documents: docKey
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

// Cap param-type growth deterministically to avoid unbounded merges.
const MAX_PARAM_CANDIDATES = 5;
const hasIterable = (value) => value != null && typeof value[Symbol.iterator] === 'function';
const createParamTypeMap = () => Object.create(null);

const ensureParamTypeMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createParamTypeMap();
  if (Object.getPrototypeOf(value) === null) return value;
  const next = createParamTypeMap();
  for (const [name, types] of Object.entries(value)) {
    if (!name) continue;
    next[name] = types;
  }
  return next;
};

const toTypeEntryCollection = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (hasIterable(value)) return Array.from(value);
  if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) return [value];
  return [];
};

const normalizeTypeEntry = (entry) => {
  if (typeof entry === 'string') {
    const type = entry.trim();
    if (!type) return null;
    return {
      type,
      source: null,
      confidence: null
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.type) return null;
  return {
    type: String(entry.type).trim(),
    source: entry.source || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
  };
};

const mergeTypeEntries = (existing, incoming, cap) => {
  const map = new Map();
  const addEntry = (entry) => {
    const normalized = normalizeTypeEntry(entry);
    if (!normalized) return;
    const key = `${normalized.type}:${normalized.source || ''}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, normalized);
      return;
    }
    const priorConfidence = Number.isFinite(prior.confidence) ? prior.confidence : 0;
    const nextConfidence = Number.isFinite(normalized.confidence) ? normalized.confidence : 0;
    if (nextConfidence > priorConfidence) map.set(key, normalized);
  };
  for (const entry of toTypeEntryCollection(existing)) addEntry(entry);
  for (const entry of toTypeEntryCollection(incoming)) addEntry(entry);
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp) return typeCmp;
    const sourceCmp = String(a.source || '').localeCompare(String(b.source || ''));
    if (sourceCmp) return sourceCmp;
    const confA = Number.isFinite(a.confidence) ? a.confidence : 0;
    const confB = Number.isFinite(b.confidence) ? b.confidence : 0;
    return confB - confA;
  });
  if (cap && list.length > cap) {
    return { list: list.slice(0, cap), truncated: true };
  }
  return { list, truncated: false };
};

const normalizeProviderOutputs = ({
  output,
  targetByChunkUid,
  chunkUidByChunkId,
  chunkUidByLegacyKey,
  strict
}) => {
  if (!output) return new Map();
  const byChunkUid = new Map();
  const consume = (chunkUid, entry) => {
    if (!chunkUid) {
      if (strict) throw new Error('Provider output missing chunkUid.');
      return;
    }
    const target = targetByChunkUid.get(chunkUid);
    const normalized = entry && typeof entry === 'object' ? { ...entry } : {};
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
  if (output.byLegacyKey) {
    const mapped = mapFromRecord(output.byLegacyKey);
    for (const [legacyKey, entry] of mapped.entries()) {
      const chunkUid = chunkUidByLegacyKey.get(legacyKey);
      if (!chunkUid) {
        if (strict) throw new Error(`Provider output legacy key unresolved (${legacyKey}).`);
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
  const next = incoming.payload || {};
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

export async function runToolingProviders(ctx, inputs, providerIds = null) {
  const strict = ctx?.strict !== false;
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [];
  const targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  const targetByChunkUid = new Map();
  const chunkUidByChunkId = new Map();
  const chunkUidByLegacyKey = new Map();

  const registerChunkId = (chunkId, chunkUid) => {
    if (!chunkId || !chunkUid) return;
    const existing = chunkUidByChunkId.get(chunkId);
    if (existing && existing !== chunkUid) {
      if (strict) throw new Error(`chunkId collision (${chunkId}) maps to multiple chunkUid values.`);
      return;
    }
    chunkUidByChunkId.set(chunkId, chunkUid);
  };

  const registerLegacyKey = (legacyKey, chunkUid) => {
    if (!legacyKey || !chunkUid) return;
    const existing = chunkUidByLegacyKey.get(legacyKey);
    if (existing && existing !== chunkUid) return;
    chunkUidByLegacyKey.set(legacyKey, chunkUid);
  };

  for (const target of targets) {
    const chunkRef = target?.chunkRef || target?.chunk || null;
    if (!chunkRef || !chunkRef.chunkUid) {
      if (strict) throw new Error('Tooling target missing chunkUid.');
      continue;
    }
    targetByChunkUid.set(chunkRef.chunkUid, target);
    registerChunkId(chunkRef.chunkId, chunkRef.chunkUid);
    const legacyName = target?.symbolHint?.name || target?.name || null;
    if (chunkRef.file && legacyName) {
      registerLegacyKey(`${chunkRef.file}::${legacyName}`, chunkRef.chunkUid);
    }
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
      documents: planDocuments
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
      chunkUidByLegacyKey,
      strict
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

  return {
    byChunkUid: merged,
    sourcesByChunkUid,
    diagnostics: providerDiagnostics,
    observations
  };
}
