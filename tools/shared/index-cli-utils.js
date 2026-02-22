import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { emitJson } from './cli-utils.js';

const isPlainRecord = (value) => (
  value != null
  && typeof value === 'object'
  && !Array.isArray(value)
);

export const DEFAULT_SNAPSHOT_RETENTION = Object.freeze({
  keepPointer: 25,
  keepFrozen: 10,
  maxAgeDays: 30,
  protectedTagGlobs: ['release', 'keep-*'],
  stagingMaxAgeHours: 24
});

export const DEFAULT_DIFF_RETENTION = Object.freeze({
  keep: 50,
  maxAgeDays: 30
});

export const DEFAULT_DIFF_COMPUTE = Object.freeze({
  modes: ['code'],
  detectRenames: true,
  includeRelations: true,
  maxChangedFiles: 200,
  maxChunksPerFile: 500,
  maxEvents: 20000,
  maxBytes: 2 * 1024 * 1024,
  persist: true
});

/**
 * Emit a CLI error in JSON or text mode.
 * @param {unknown} err
 * @param {boolean} asJson
 * @returns {void}
 */
export const emitCliError = (err, asJson) => {
  const code = err?.code || ERROR_CODES.INTERNAL;
  const message = err?.message || String(err);
  if (asJson) {
    emitJson({ ok: false, code, message });
  } else {
    process.stderr.write(`${message}\n`);
  }
};

/**
 * Normalize a value into a floored integer with lower bound.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} [minimum]
 * @returns {number}
 */
export const normalizeWholeNumber = (value, fallback, minimum = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(minimum, Math.floor(num));
};

/**
 * Normalize loose boolean flags used by CLI/config values.
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
export const normalizeBooleanFlag = (value, fallback = false) => {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
};

/**
 * Parse comma-separated input into trimmed tokens.
 * @param {unknown} value
 * @returns {string[]}
 */
export const parseCommaString = (value) => (
  String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
);

const parseCommaOrArray = (value) => (
  Array.isArray(value)
    ? value
    : parseCommaString(value)
);

const getIndexingSection = (userConfig, sectionKey) => {
  if (!isPlainRecord(userConfig)) return null;
  const indexing = isPlainRecord(userConfig.indexing) ? userConfig.indexing : null;
  if (!indexing) return null;
  const section = indexing[sectionKey];
  if (!isPlainRecord(section)) return null;
  return section;
};

const normalizeTagGlobs = (value, fallback) => {
  const raw = parseCommaOrArray(value);
  const selected = raw.length ? raw : fallback;
  const deduped = [];
  for (const tag of selected) {
    const normalized = String(tag || '').trim();
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped.length ? deduped : [...fallback];
};

const normalizeModes = (value, fallback = DEFAULT_DIFF_COMPUTE.modes) => {
  const raw = parseCommaOrArray(value);
  const selected = raw.length ? raw : fallback;
  const deduped = [];
  for (const mode of selected) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped.length ? deduped : [...DEFAULT_DIFF_COMPUTE.modes];
};

/**
 * Resolve snapshot retention defaults from user config with legacy key support.
 * @param {object} userConfig
 * @returns {{keepPointer:number,keepFrozen:number,maxAgeDays:number,protectedTagGlobs:string[],stagingMaxAgeHours:number}}
 */
export const resolveSnapshotDefaults = (userConfig) => {
  const snapshots = getIndexingSection(userConfig, 'snapshots');
  if (!snapshots) {
    return {
      ...DEFAULT_SNAPSHOT_RETENTION,
      protectedTagGlobs: [...DEFAULT_SNAPSHOT_RETENTION.protectedTagGlobs]
    };
  }
  return {
    keepPointer: normalizeWholeNumber(
      snapshots.keepPointer ?? snapshots.maxPointerSnapshots,
      DEFAULT_SNAPSHOT_RETENTION.keepPointer
    ),
    keepFrozen: normalizeWholeNumber(
      snapshots.keepFrozen ?? snapshots.maxFrozenSnapshots,
      DEFAULT_SNAPSHOT_RETENTION.keepFrozen
    ),
    maxAgeDays: normalizeWholeNumber(
      snapshots.maxAgeDays ?? snapshots.retainDays,
      DEFAULT_SNAPSHOT_RETENTION.maxAgeDays
    ),
    protectedTagGlobs: normalizeTagGlobs(
      snapshots.protectedTagGlobs ?? snapshots.keepTags,
      DEFAULT_SNAPSHOT_RETENTION.protectedTagGlobs
    ),
    stagingMaxAgeHours: normalizeWholeNumber(
      snapshots.stagingMaxAgeHours,
      DEFAULT_SNAPSHOT_RETENTION.stagingMaxAgeHours
    )
  };
};

/**
 * Resolve diff retention and compute defaults from user config with legacy key support.
 * @param {object} userConfig
 * @returns {{keep:number,maxAgeDays:number,compute:{modes:string[],detectRenames:boolean,includeRelations:boolean,maxChangedFiles:number,maxChunksPerFile:number,maxEvents:number,maxBytes:number,persist:boolean}}}
 */
export const resolveDiffDefaults = (userConfig) => {
  const diffs = getIndexingSection(userConfig, 'diffs');
  if (!diffs) {
    return {
      keep: DEFAULT_DIFF_RETENTION.keep,
      maxAgeDays: DEFAULT_DIFF_RETENTION.maxAgeDays,
      compute: {
        ...DEFAULT_DIFF_COMPUTE,
        modes: [...DEFAULT_DIFF_COMPUTE.modes]
      }
    };
  }
  const compute = isPlainRecord(diffs.compute) ? diffs.compute : {};
  return {
    keep: normalizeWholeNumber(
      diffs.keep ?? diffs.maxDiffs,
      DEFAULT_DIFF_RETENTION.keep
    ),
    maxAgeDays: normalizeWholeNumber(
      diffs.maxAgeDays ?? diffs.retainDays,
      DEFAULT_DIFF_RETENTION.maxAgeDays
    ),
    compute: {
      modes: normalizeModes(compute.modes),
      detectRenames: normalizeBooleanFlag(compute.detectRenames, DEFAULT_DIFF_COMPUTE.detectRenames),
      includeRelations: normalizeBooleanFlag(
        compute.includeRelations,
        DEFAULT_DIFF_COMPUTE.includeRelations
      ),
      maxChangedFiles: normalizeWholeNumber(
        compute.maxChangedFiles,
        DEFAULT_DIFF_COMPUTE.maxChangedFiles,
        1
      ),
      maxChunksPerFile: normalizeWholeNumber(
        compute.maxChunksPerFile,
        DEFAULT_DIFF_COMPUTE.maxChunksPerFile,
        1
      ),
      maxEvents: normalizeWholeNumber(
        compute.maxEvents ?? diffs.maxEvents,
        DEFAULT_DIFF_COMPUTE.maxEvents,
        1
      ),
      maxBytes: normalizeWholeNumber(
        compute.maxBytes ?? diffs.maxBytes,
        DEFAULT_DIFF_COMPUTE.maxBytes,
        1
      ),
      persist: normalizeBooleanFlag(
        compute.persist ?? compute.persistEvents,
        DEFAULT_DIFF_COMPUTE.persist
      )
    }
  };
};
