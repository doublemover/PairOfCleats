import { createArtifactCompressionTierResolver } from '../../../shared/artifact-io/compression.js';

const DEFAULT_HOT_TIER_ARTIFACTS = Object.freeze([
  'chunk_meta',
  'chunk_uid_map',
  'file_meta',
  'token_postings',
  'token_postings_packed',
  'token_postings_binary-columnar',
  'dense_vectors_uint8',
  'dense_vectors_doc_uint8',
  'dense_vectors_code_uint8',
  'dense_meta',
  'index_state',
  'pieces_manifest'
]);

const DEFAULT_COLD_TIER_ARTIFACTS = Object.freeze([
  'repo_map',
  'risk_summaries',
  'risk_flows',
  'call_sites',
  'graph_relations',
  'graph_relations_meta',
  'determinism_report',
  'extraction_report',
  'vocab_order'
]);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Normalize user-provided tier artifact names into a clean list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
const normalizeTierArtifactList = (value) => (
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim())
    : []
);

const normalizeCompressionTierConfig = (artifactConfig = {}) => (
  artifactConfig.compressionTiers && typeof artifactConfig.compressionTiers === 'object'
    ? artifactConfig.compressionTiers
    : {}
);

const normalizeCompressionOverrides = (value) => (
  value && typeof value === 'object'
    ? { ...value }
    : {}
);

/**
 * Build compression tiering policy and override resolvers for artifact writes.
 *
 * The returned helpers memoize per-artifact shard compression resolution so
 * hot-path write scheduling can avoid repeated override/tier checks.
 *
 * @param {{
 *   artifactConfig?:object,
 *   compressionOverrides?:object|null,
 *   compressibleArtifacts?:Set<string>|string[],
 *   compressionEnabled?:boolean,
 *   compressionMode?:string|null,
 *   compressionKeepRaw?:boolean
 * }} [input]
 * @returns {{
 *   tieredCompressionOverrides:Record<string,object>,
 *   resolveArtifactTier:(artifactName:string)=>'hot'|'warm'|'cold',
 *   resolveCompressionOverride:(base:string)=>object|null,
 *   resolveShardCompression:(base:string)=>string|null
 * }}
 */
export const buildTieredCompressionPolicy = ({
  artifactConfig = {},
  compressionOverrides = null,
  compressibleArtifacts = new Set(),
  compressionEnabled = false,
  compressionMode = null,
  compressionKeepRaw = false
} = {}) => {
  const compressionTierConfig = normalizeCompressionTierConfig(artifactConfig);
  const compressionTiersEnabled = compressionTierConfig.enabled !== false;
  const compressionTierHotNoCompression = compressionTierConfig.hotNoCompression !== false;
  const compressionTierColdForceCompression = compressionTierConfig.coldForceCompression !== false;
  const tierHotArtifacts = normalizeTierArtifactList(compressionTierConfig.hotArtifacts);
  const tierColdArtifacts = normalizeTierArtifactList(compressionTierConfig.coldArtifacts);

  const resolveArtifactTier = createArtifactCompressionTierResolver({
    hotArtifacts: tierHotArtifacts.length ? tierHotArtifacts : DEFAULT_HOT_TIER_ARTIFACTS,
    coldArtifacts: tierColdArtifacts.length ? tierColdArtifacts : DEFAULT_COLD_TIER_ARTIFACTS,
    defaultTier: 'warm'
  });

  const tieredCompressionOverrides = normalizeCompressionOverrides(compressionOverrides);
  if (compressionTiersEnabled) {
    for (const artifactName of compressibleArtifacts) {
      if (hasOwn(tieredCompressionOverrides, artifactName)) continue;
      const tier = resolveArtifactTier(artifactName);
      if (tier === 'hot' && compressionTierHotNoCompression) {
        tieredCompressionOverrides[artifactName] = {
          enabled: false,
          mode: compressionMode,
          keepRaw: true
        };
        continue;
      }
      if (tier === 'cold' && compressionTierColdForceCompression && compressionEnabled && compressionMode) {
        tieredCompressionOverrides[artifactName] = {
          enabled: true,
          mode: compressionMode,
          keepRaw: compressionKeepRaw
        };
      }
    }
  }

  const overrideCache = new Map();
  /**
   * Resolve explicit compression override for an artifact base name.
   *
   * @param {string} base
   * @returns {object|null}
   */
  const resolveCompressionOverride = (base) => {
    const cacheKey = typeof base === 'string' ? base : String(base || '');
    if (overrideCache.has(cacheKey)) return overrideCache.get(cacheKey);
    const resolved = hasOwn(tieredCompressionOverrides, cacheKey)
      ? tieredCompressionOverrides[cacheKey]
      : null;
    overrideCache.set(cacheKey, resolved);
    return resolved;
  };

  const shardCompressionCache = new Map();
  /**
   * Resolve effective shard compression mode after override/tier policy.
   *
   * @param {string} base
   * @returns {string|null}
   */
  const resolveShardCompression = (base) => {
    const cacheKey = typeof base === 'string' ? base : String(base || '');
    if (shardCompressionCache.has(cacheKey)) return shardCompressionCache.get(cacheKey);
    const override = resolveCompressionOverride(cacheKey);
    let resolved = null;
    if (override) {
      resolved = override.enabled ? override.mode : null;
    } else {
      resolved = compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(cacheKey)
        ? compressionMode
        : null;
    }
    shardCompressionCache.set(cacheKey, resolved);
    return resolved;
  };

  return {
    tieredCompressionOverrides,
    resolveArtifactTier,
    resolveCompressionOverride,
    resolveShardCompression
  };
};
