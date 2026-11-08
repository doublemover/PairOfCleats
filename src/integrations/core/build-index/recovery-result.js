const COUNTERS = ['files', 'chunks', 'bytes', 'embeddedFiles', 'embeddedChunks', 'processedFiles', 'processedChunks',
  'writtenFiles', 'writtenChunks', 'indexedFiles', 'indexedChunks', 'rows', 'vectors', 'reused', 'computed',
  'parsedFiles', 'selectedFiles', 'artifactPieces', 'artifactBytes', 'restoredPieces', 'copiedBytes'];
const FLAGS = ['ok', 'enabled', 'skipped', 'queued', 'cancelled', 'mixed', 'notAdmitted', 'background', 'ready'];
const LABELS = ['status', 'reason', 'code', 'queueId', 'backend', 'provider', 'originatingAttemptId', 'sourceBuildId'];
const GRAPH_IDENTITY = ['schemaVersion', 'artifactSurfaceVersion', 'validationPolicyVersion', 'capability', 'mode',
  'repoRoot', 'sourceBuildRoot', 'buildId', 'indexRoot', 'indexDir', 'descriptorHash', 'semanticGeneration',
  'coverageHash', 'capabilityId', 'status'];
export const MAX_DURABLE_RECOVERY_RESULT_BYTES = 128 * 1024;

/** Existing runtime attempts and backend logs own detailed execution evidence.
 * The transaction stores bounded facts, never another copy of backend output.
 */
const facts = value => {
  if (!value || typeof value !== 'object') return { status: 'unknown' };
  const result = {};
  for (const key of COUNTERS) if (Object.hasOwn(value, key)) {
    const item = value[key];
    result[key] = Number.isSafeInteger(item) && item >= 0 ? item : null;
  }
  for (const key of FLAGS) {
    const item = value[key];
    if (typeof item === 'boolean') result[key] = item;
  }
  for (const key of LABELS) {
    const item = value[key];
    if (typeof item !== 'string') continue;
    result[key] = item.slice(0, 512);
    if (item.length > 512) result[`${key}Truncated`] = true;
  }
  return result;
};

export const summarizeRecoveryBackend = (value, kind) => {
  const result = facts(value);
  if (Array.isArray(value?.perMode)) {
    result.perMode = value.perMode.slice(0, 4).map(row => ({ mode: typeof row.mode === 'string' ? row.mode.slice(0, 32) : null,
      ...facts(row[kind] || row) }));
    if (value.perMode.length > 4) result.perModeTruncated = true;
  }
  return result;
};

export const summarizeRecoveryModeWork = modes => {
  if (!modes || typeof modes !== 'object') return null;
  return Object.fromEntries(['code', 'prose', 'extracted-prose', 'records'].filter(mode => Object.hasOwn(modes, mode))
    .map(mode => [mode, { ...facts(modes[mode]), ...(modes[mode]?.dependencies ? {
      dependencies: { tasks: Number.isSafeInteger(modes[mode].dependencies.tasks) && modes[mode].dependencies.tasks >= 0 ? modes[mode].dependencies.tasks : null,
        inventories: Number.isSafeInteger(modes[mode].dependencies.inventories) && modes[mode].dependencies.inventories >= 0 ? modes[mode].dependencies.inventories : null }
    } : {}) }]));
};

export const durableRecoveryResult = result => {
  const { execution: _execution, ...durable } = result;
  if (durable.graph) durable.graph = Object.fromEntries(GRAPH_IDENTITY.filter(key => Object.hasOwn(durable.graph, key))
    .map(key => [key, durable.graph[key]]));
  const encoded = JSON.stringify(durable);
  if (Buffer.byteLength(encoded) > MAX_DURABLE_RECOVERY_RESULT_BYTES) throw Object.assign(
    new Error('Recovery completion facts exceeded their bounded metadata allowance.'), { code: 'ERR_RECOVERY_RECEIPT_TOO_LARGE' });
  return JSON.parse(encoded);
};
