import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { acquireIndexLock } from '../build/lock.js';
import { resolveIndexRef } from '../index-ref.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringify } from '../../shared/stable-json.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import {
  loadDiffInputs,
  loadDiffSummary,
  loadDiffsManifest,
  writeDiffInputs,
  writeDiffSummary,
  writeDiffsManifest
} from './registry.js';
import { computeModeDiff } from './chunk-diff.js';
import {
  applyEventBounds,
  modeRank,
  normalizeModes,
  serializeEvent,
  sortEvents,
  toEventCounts
} from './events.js';
import {
  buildCompactConfigValue,
  buildCompactToolValue,
  buildDiffEndpoint,
  compareCompat,
  parseCreatedAtMs,
  sortDiffEntries
} from './manifest.js';

const DIFF_ID_RE = /^diff_[A-Za-z0-9._-]+$/;
const DEFAULT_MAX_CHANGED_FILES = 200;
const DEFAULT_MAX_CHUNKS_PER_FILE = 500;
const DEFAULT_MAX_EVENTS = 20000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DIFFS = 50;
const DEFAULT_RETAIN_DAYS = 30;

const invalidRequest = (message, details = null) => createError(ERROR_CODES.INVALID_REQUEST, message, details);
const notFound = (message, details = null) => createError(ERROR_CODES.NOT_FOUND, message, details);
const queueError = (message, details = null) => createError(ERROR_CODES.QUEUE_OVERLOADED, message, details);
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const ensureDiffId = (diffId) => {
  if (typeof diffId !== 'string' || !DIFF_ID_RE.test(diffId)) {
    throw invalidRequest(`Invalid diff id "${diffId}".`);
  }
};

const withDiffLock = async (repoCacheRoot, options, worker) => {
  const lock = await acquireIndexLock({
    repoCacheRoot,
    waitMs: Number.isFinite(options?.waitMs) ? Number(options.waitMs) : 0,
    pollMs: Number.isFinite(options?.pollMs) ? Number(options.pollMs) : 1000,
    staleMs: Number.isFinite(options?.staleMs) ? Number(options.staleMs) : undefined,
    log: typeof options?.log === 'function' ? options.log : () => {}
  });
  if (!lock) {
    throw queueError('Index lock held; unable to mutate diffs.');
  }
  try {
    return await worker(lock);
  } finally {
    await lock.release();
  }
};

const normalizePositiveInt = (value, fallback) => {
  if (!Number.isFinite(Number(value))) return fallback;
  return Math.max(1, Math.floor(Number(value)));
};

const computeSelectedModeDiffs = async ({
  selectedModes,
  resolvedFrom,
  resolvedTo,
  options,
  notFound
}) => Promise.all(selectedModes.map(async (mode) => {
  const fromDir = resolvedFrom.indexDirByMode?.[mode];
  const toDir = resolvedTo.indexDirByMode?.[mode];
  if (!fromDir || !toDir) {
    throw notFound(`Missing resolved mode roots for ${mode}.`);
  }
  return computeModeDiff({
    mode,
    fromDir,
    toDir,
    detectRenames: options.detectRenames,
    includeRelations: options.includeRelations,
    maxChangedFiles: options.maxChangedFiles,
    maxChunksPerFile: options.maxChunksPerFile
  });
}));

const writeEventsJsonl = async (repoCacheRoot, diffId, events) => {
  const eventsPath = path.join(repoCacheRoot, 'diffs', diffId, 'events.jsonl');
  const payload = events.map((entry) => serializeEvent(entry)).join('\n');
  await atomicWriteText(eventsPath, payload.length ? `${payload}\n` : '', { newline: false });
  return eventsPath;
};

const readEventsJsonl = (eventsPath) => {
  if (!fs.existsSync(eventsPath)) return [];
  const lines = fs.readFileSync(eventsPath, 'utf8').split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed));
  }
  return events;
};

const hasPathRef = (parsed) => parsed?.kind === 'path';

export const computeIndexDiff = async ({
  repoRoot,
  userConfig = null,
  from,
  to,
  modes = ['code'],
  detectRenames = true,
  includeRelations = true,
  maxChangedFiles = DEFAULT_MAX_CHANGED_FILES,
  maxChunksPerFile = DEFAULT_MAX_CHUNKS_PER_FILE,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxBytes = DEFAULT_MAX_BYTES,
  allowMismatch = false,
  persist = true,
  persistUnsafe = false,
  waitMs = 0,
  dryRun = false
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const fromRef = typeof from === 'string' && from.trim() ? from.trim() : null;
  const toRef = typeof to === 'string' && to.trim() ? to.trim() : null;
  if (!fromRef || !toRef) {
    throw invalidRequest('Both --from and --to refs are required.');
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const selectedModes = normalizeModes(modes, { invalidRequest })
    .sort((left, right) => modeRank(left) - modeRank(right));
  const resolvedFrom = resolveIndexRef({
    ref: fromRef,
    repoRoot: resolvedRepoRoot,
    userConfig,
    requestedModes: selectedModes,
    preferFrozen: true,
    allowMissingModes: false
  });
  const resolvedTo = resolveIndexRef({
    ref: toRef,
    repoRoot: resolvedRepoRoot,
    userConfig,
    requestedModes: selectedModes,
    preferFrozen: true,
    allowMissingModes: false
  });

  const compat = compareCompat({ fromResolved: resolvedFrom, toResolved: resolvedTo, modes: selectedModes });
  if (compat.configHashMismatch && allowMismatch !== true) {
    throw invalidRequest('configHash mismatch between --from and --to. Use --allow-mismatch to continue.');
  }

  const options = {
    detectRenames: detectRenames === true,
    includeRelations: includeRelations === true,
    maxChangedFiles: normalizePositiveInt(maxChangedFiles, DEFAULT_MAX_CHANGED_FILES),
    maxChunksPerFile: normalizePositiveInt(maxChunksPerFile, DEFAULT_MAX_CHUNKS_PER_FILE)
  };
  const inputsCanonical = {
    version: 1,
    kind: 'semantic-v1',
    from: {
      ref: resolvedFrom.canonical,
      identityHash: resolvedFrom.identityHash,
      identity: resolvedFrom.identity
    },
    to: {
      ref: resolvedTo.canonical,
      identityHash: resolvedTo.identityHash,
      identity: resolvedTo.identity
    },
    modes: selectedModes,
    options
  };
  const identityHash = sha1(stableStringify(inputsCanonical));
  const diffId = `diff_${identityHash.slice(0, 16)}`;
  ensureDiffId(diffId);
  const createdAt = new Date().toISOString();
  const fromEndpoint = buildDiffEndpoint({ resolved: resolvedFrom, modes: selectedModes });
  const toEndpoint = buildDiffEndpoint({ resolved: resolvedTo, modes: selectedModes });
  const maxEventsLimit = normalizePositiveInt(maxEvents, DEFAULT_MAX_EVENTS);
  const maxBytesLimit = normalizePositiveInt(maxBytes, DEFAULT_MAX_BYTES);

  const modeResults = await computeSelectedModeDiffs({
    selectedModes,
    resolvedFrom,
    resolvedTo,
    options,
    notFound
  });

  const allEventsSorted = sortEvents(modeResults.flatMap((entry) => entry.events));
  const bounded = applyEventBounds(allEventsSorted, {
    maxEvents: maxEventsLimit,
    maxBytes: maxBytesLimit
  });
  const modesSummary = Object.fromEntries(modeResults.map((entry) => [entry.mode, entry.summary]));
  const summary = {
    id: diffId,
    createdAt,
    from: fromEndpoint,
    to: toEndpoint,
    modes: selectedModes,
    orderingSchema: 'diff-events-v1',
    truncated: bounded.truncated,
    limits: {
      maxEvents: maxEventsLimit,
      maxBytes: maxBytesLimit,
      reason: bounded.reason
    },
    totals: {
      allEvents: allEventsSorted.length,
      emittedEvents: bounded.events.length,
      byKind: toEventCounts(allEventsSorted)
    },
    modesSummary,
    compat
  };
  const inputs = {
    id: diffId,
    createdAt,
    from: fromEndpoint,
    to: toEndpoint,
    modes: selectedModes,
    allowMismatch: allowMismatch === true,
    identityHash,
    fromConfigHash: buildCompactConfigValue(resolvedFrom, selectedModes),
    toConfigHash: buildCompactConfigValue(resolvedTo, selectedModes),
    fromToolVersion: buildCompactToolValue(resolvedFrom, selectedModes),
    toToolVersion: buildCompactToolValue(resolvedTo, selectedModes),
    options: inputsCanonical.options
  };

  const hasPathInputs = hasPathRef(resolvedFrom.parsed) || hasPathRef(resolvedTo.parsed);
  const persistEnabled = persist !== false && dryRun !== true && !(hasPathInputs && persistUnsafe !== true);
  const repoCacheRoot = getRepoCacheRoot(resolvedRepoRoot, userConfig);

  if (!persistEnabled) {
    return {
      diffId,
      createdAt,
      persisted: false,
      inputs,
      summary,
      events: bounded.events,
      pathRefNotPersisted: hasPathInputs && persistUnsafe !== true
    };
  }

  return withDiffLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadDiffsManifest(repoCacheRoot);
    const existingEntry = manifest.diffs?.[diffId];
    if (existingEntry) {
      const existingInputs = loadDiffInputs(repoCacheRoot, diffId);
      if (existingInputs?.identityHash === identityHash) {
        return {
          diffId,
          createdAt: existingEntry.createdAt || createdAt,
          persisted: true,
          reused: true,
          inputs: existingInputs,
          summary: loadDiffSummary(repoCacheRoot, diffId),
          eventsPath: existingEntry.eventsPath || null
        };
      }
      throw createError(ERROR_CODES.INTERNAL, `diffId collision for ${diffId}.`);
    }

    await writeDiffInputs(repoCacheRoot, diffId, inputs, { lock, persistUnsafe: persistUnsafe === true });
    await writeDiffSummary(repoCacheRoot, diffId, summary, { lock, persistUnsafe: persistUnsafe === true });
    const eventsFilePath = await writeEventsJsonl(repoCacheRoot, diffId, bounded.events);
    const eventsRelPath = path.relative(repoCacheRoot, eventsFilePath).replace(/\\/g, '/');
    const summaryRelPath = `diffs/${diffId}/summary.json`;

    if (!isObject(manifest.diffs)) manifest.diffs = {};
    manifest.version = Number.isFinite(manifest.version) ? manifest.version : 1;
    manifest.updatedAt = createdAt;
    manifest.diffs[diffId] = {
      id: diffId,
      createdAt,
      from: fromEndpoint,
      to: toEndpoint,
      modes: selectedModes,
      summaryPath: summaryRelPath,
      eventsPath: eventsRelPath,
      truncated: bounded.truncated,
      maxEvents: maxEventsLimit,
      maxBytes: maxBytesLimit,
      compat
    };

    const sortedEntries = sortDiffEntries(Object.values(manifest.diffs || {}));
    manifest.diffs = Object.fromEntries(sortedEntries.map((entry) => [entry.id, entry]));
    await writeDiffsManifest(repoCacheRoot, manifest, { lock, persistUnsafe: persistUnsafe === true });

    return {
      diffId,
      createdAt,
      persisted: true,
      reused: false,
      inputs,
      summary,
      eventsPath: eventsRelPath,
      emittedEvents: bounded.events.length
    };
  });
};

export const listDiffs = ({
  repoRoot,
  userConfig = null,
  modes = []
} = {}) => {
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const hasModeFilter = Array.isArray(modes)
    ? modes.some((mode) => String(mode ?? '').trim().length > 0)
    : (typeof modes === 'string' ? modes.trim().length > 0 : false);
  const selectedModes = hasModeFilter ? normalizeModes(modes, { invalidRequest }) : [];
  const manifest = loadDiffsManifest(repoCacheRoot);
  const entries = sortDiffEntries(Object.values(manifest.diffs || {}));
  if (!selectedModes.length) return entries;
  return entries.filter((entry) => {
    const entryModes = Array.isArray(entry?.modes) ? entry.modes : [];
    return selectedModes.every((mode) => entryModes.includes(mode));
  });
};

export const showDiff = ({
  repoRoot,
  userConfig = null,
  diffId,
  format = 'summary'
} = {}) => {
  ensureDiffId(diffId);
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const manifest = loadDiffsManifest(repoCacheRoot);
  const entry = manifest.diffs?.[diffId] || null;
  if (!entry) return null;
  const inputs = loadDiffInputs(repoCacheRoot, diffId);
  const summary = loadDiffSummary(repoCacheRoot, diffId);
  if (String(format || 'summary').trim().toLowerCase() !== 'jsonl') {
    return { entry, inputs, summary };
  }
  const eventsPath = path.join(repoCacheRoot, 'diffs', diffId, 'events.jsonl');
  const events = readEventsJsonl(eventsPath);
  return { entry, inputs, summary, events };
};

export const pruneDiffs = async ({
  repoRoot,
  userConfig = null,
  maxDiffs = DEFAULT_MAX_DIFFS,
  retainDays = DEFAULT_RETAIN_DAYS,
  dryRun = false,
  waitMs = 0
} = {}) => {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) {
    throw invalidRequest('repoRoot is required.');
  }
  const repoCacheRoot = getRepoCacheRoot(path.resolve(repoRoot), userConfig);
  const maxCount = Number.isFinite(Number(maxDiffs))
    ? Math.max(0, Math.floor(Number(maxDiffs)))
    : DEFAULT_MAX_DIFFS;
  const cutoffMs = Number.isFinite(Number(retainDays))
    ? Date.now() - Math.max(0, Number(retainDays)) * 24 * 60 * 60 * 1000
    : null;
  const dryRunEnabled = dryRun === true;

  return withDiffLock(repoCacheRoot, { waitMs }, async (lock) => {
    const manifest = loadDiffsManifest(repoCacheRoot);
    const entries = sortDiffEntries(Object.values(manifest.diffs || {}));
    const removed = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const createdAtMs = parseCreatedAtMs(entry.createdAt);
      const withinKeep = i < maxCount;
      const youngerThanCutoff = cutoffMs == null || createdAtMs >= cutoffMs;
      const keep = cutoffMs == null
        ? withinKeep
        : (withinKeep || youngerThanCutoff);
      if (keep) continue;
      removed.push(entry.id);
      if (!dryRunEnabled) {
        await fsPromises.rm(path.join(repoCacheRoot, 'diffs', entry.id), {
          recursive: true,
          force: true
        });
        delete manifest.diffs[entry.id];
      }
    }
    if (!dryRunEnabled && removed.length) {
      manifest.updatedAt = new Date().toISOString();
      const nextEntries = sortDiffEntries(Object.values(manifest.diffs || {}));
      manifest.diffs = Object.fromEntries(nextEntries.map((entry) => [entry.id, entry]));
      await writeDiffsManifest(repoCacheRoot, manifest, { lock });
    }
    return { dryRun: dryRunEnabled, removed };
  });
};
