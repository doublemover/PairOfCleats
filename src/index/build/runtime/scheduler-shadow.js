import { createHash } from 'node:crypto';
import { stableStringify } from '../../../shared/stable-json.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../semantic/analysis-versions.js';
import { estimateFileCost } from '../perf-profile.js';
import { getLanguageRouteForFile } from '../../language-registry/routing.js';
import path from 'node:path';
import { currentSchedulerTaskLease } from '../../../shared/concurrency/scheduler-task-scope.js';

const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const boundedIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const compatibleProjection = value => {
  let nodes = 0, bytes = 0;
  const seen = new Set();
  const visit = (entry, depth = 0) => {
    if (++nodes > 4096 || depth > 24) throw new Error('Unsupported shadow identity.');
    if (typeof entry === 'string') bytes += Buffer.byteLength(entry);
    else if (entry == null || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))) bytes += 16;
    else if (typeof entry !== 'object' || seen.has(entry)
      || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)) {
      throw new Error('Unsupported shadow identity.');
    } else {
      seen.add(entry);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
        if (!descriptor.enumerable) continue;
        if (!('value' in descriptor)) throw new Error('Unsupported shadow identity.');
        bytes += Buffer.byteLength(key); visit(descriptor.value, depth + 1);
      }
      seen.delete(entry);
    }
    if (bytes > 64 * 1024) throw new Error('Unsupported shadow identity.');
  };
  visit(value);
};
const costFields = ['files', 'bytes', 'lines', 'durationMs', 'avgMsPerFile', 'byteCostMs', 'lineCostMs'];
const totals = value => Object.fromEntries(costFields.map(key => [key,
  Number.isFinite(value?.[key]) && value[key] >= 0 ? value[key] : 0]));
const snapshotCostProfile = profile => {
  if (!profile || Object.keys(profile.languages || {}).length > 128 || !Array.isArray(profile.buckets)
    || profile.buckets.length > 32 || !boundedIdentity(profile.configHash) || !boundedIdentity(profile.buildId)
    || typeof profile.generatedAt !== 'string' || profile.generatedAt.length > 64
    || Object.keys(profile.languages || {}).some(key => key.length > 64)
    || profile.buckets.some(bucket => typeof bucket?.id !== 'string' || bucket.id.length > 64
      || (bucket.maxBytes != null && !(Number.isFinite(bucket.maxBytes) && bucket.maxBytes >= 0)))) return null;
  const languages = Object.fromEntries(Object.entries(profile.languages || {}).map(([key, value]) => [key,
    { totals: totals(value.totals), buckets: Object.fromEntries(profile.buckets.map(bucket => [bucket.id, totals(value.buckets?.[bucket.id])])) }]));
  return { version: profile.version, configHash: profile.configHash, buildId: profile.buildId, generatedAt: profile.generatedAt,
    schedulerReplayIdentity: { ...profile.schedulerReplayIdentity }, totals: totals(profile.totals), languages,
    buckets: profile.buckets.map(bucket => ({ id: String(bucket.id).slice(0, 64), maxBytes: bucket.maxBytes ?? null })) };
};

/** A profile without this exact prospective compatibility receipt is useful to
 * its existing shard owner, but cannot authorize cost-aware dispatch evidence. */
export const createSchedulerReplayProfileIdentity = ({ configHash, mode, parserIdentity, runtimeIdentity,
  repositoryFeatures, resourceIdentity, features } = {}) => {
  if (!boundedIdentity(configHash) || !boundedIdentity(mode) || !parserIdentity || !runtimeIdentity
    || !repositoryFeatures || !features || !boundedIdentity(resourceIdentity)) return null;
  try {
    const projection = { configHash, mode, parserIdentity, runtimeIdentity, repositoryFeatures, features,
      producers: SEMANTIC_ANALYSIS_VERSIONS };
    compatibleProjection(projection);
    return { version: 1, compatibilityIdentity: digest(projection), resourceIdentity };
  } catch { return null; }
};

/** Internal producer adapter for the existing learned-auto-profile opt-in.
 * Call after ordered/window dependency gates; it never changes their authority. */
export const createFileSchedulerShadow = ({ learnedAutoProfile, perfProfile, identity, mode,
  domain = mode, getCommitState, resolveOrderIndex, currentBuildId } = {}) => {
  const enabled = learnedAutoProfile?.enabled === true && boundedIdentity(domain);
  let profile = null;
  try { if (enabled) profile = snapshotCostProfile(perfProfile); } catch {}
  const qualified = Boolean(identity && boundedIdentity(currentBuildId) && profile?.buildId !== currentBuildId
    && profile?.schedulerReplayIdentity?.version === 1
    && profile.schedulerReplayIdentity.compatibilityIdentity === identity.compatibilityIdentity
    && profile.schedulerReplayIdentity.resourceIdentity === identity.resourceIdentity);
  const profileIdentity = qualified ? digest(profile) : null;
  return {
    context: { enabled, compatibilityIdentity: identity?.compatibilityIdentity || null,
      getCommitState: () => {
        const state = getCommitState?.();
        return state ? { domain, nextIndex: state.nextIndex, maxAhead: state.maxAhead } : null;
      } },
    metadata: enabled ? (entry, ctx) => {
      const bytes = Math.max(0, Math.floor(Number(entry?.stat?.size ?? entry?.bytes) || 0));
      const language = getLanguageRouteForFile(path.extname(entry?.abs || entry?.rel || '').toLowerCase(), entry?.rel || '')?.id;
      const predicted = qualified ? estimateFileCost({ perfProfile: profile, languageId: language,
        bytes, lines: Number(entry?.lines) || 0 }) : null;
      return { domain, orderIndex: resolveOrderIndex?.(entry, ctx?.index) ?? null, dependencyState: 'ready',
        predictedDurationMs: predicted, predictedBytes: bytes, profileIdentity,
        compatibilityIdentity: qualified ? identity.compatibilityIdentity : null,
        resourceIdentity: qualified ? identity.resourceIdentity : null,
        featureIdentity: identity?.compatibilityIdentity || null };
    } : null,
    captureCommitIdentity: orderIndex => {
      const attempt = currentSchedulerTaskLease()?.replayIdentity;
      return attempt?.domain === domain && attempt.orderIndex === orderIndex ? attempt : null;
    },
    noteCommitted: (scheduler, orderIndex, { identity: attempt = null, status = 'completed' } = {}) => {
      scheduler?.noteDispatchReplayCommit?.({ domain, orderIndex,
        taskId: attempt?.domain === domain && attempt.orderIndex === orderIndex ? attempt.taskId : null,
        status: status === 'complete' ? 'completed' : status });
    }
  };
};
