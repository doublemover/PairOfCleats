export const INDEX_PROFILE_DEFAULT = 'default';
export const INDEX_PROFILE_VECTOR_ONLY = 'vector_only';
export const INDEX_PROFILE_SCHEMA_VERSION = 1;
export const INDEX_STATE_ARTIFACTS_SCHEMA_VERSION = 1;

export const INDEX_PROFILE_IDS = Object.freeze([
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_VECTOR_ONLY
]);

const INDEX_PROFILE_SET = new Set(INDEX_PROFILE_IDS);

const REQUIRED_ARTIFACTS_BY_PROFILE = Object.freeze({
  [INDEX_PROFILE_DEFAULT]: Object.freeze([
    'chunk_meta',
    'token_postings',
    'index_state',
    'filelists'
  ]),
  [INDEX_PROFILE_VECTOR_ONLY]: Object.freeze([
    'chunk_meta',
    'dense_vectors',
    'index_state',
    'filelists'
  ])
});

const normalizeString = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const isKnownIndexProfileId = (value) => INDEX_PROFILE_SET.has(normalizeString(value));

/**
 * Validate profile id with strict type checks.
 * Null/undefined and empty strings normalize to the default profile, while
 * non-string explicit values are rejected to surface configuration mistakes.
 *
 * @param {unknown} value
 * @param {string} [fieldName='indexing.profile']
 * @returns {string}
 */
export const assertKnownIndexProfileId = (value, fieldName = 'indexing.profile') => {
  if (value == null) return INDEX_PROFILE_DEFAULT;
  if (typeof value !== 'string') {
    throw new Error(
      `${fieldName} must be a string (${INDEX_PROFILE_IDS.join(', ')}). Received type: ${typeof value}`
    );
  }
  const normalized = normalizeString(value);
  if (!normalized) return INDEX_PROFILE_DEFAULT;
  if (INDEX_PROFILE_SET.has(normalized)) return normalized;
  throw new Error(
    `${fieldName} must be one of: ${INDEX_PROFILE_IDS.join(', ')}. Received: ${String(value)}`
  );
};

/**
 * Normalize profile id for permissive readers. Unknown/non-string values map
 * to `fallback` so legacy payloads continue to load safely.
 *
 * @param {unknown} value
 * @param {string} [fallback=INDEX_PROFILE_DEFAULT]
 * @returns {string}
 */
export const normalizeIndexProfileId = (value, fallback = INDEX_PROFILE_DEFAULT) => {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  if (!INDEX_PROFILE_SET.has(normalized)) return fallback;
  return normalized;
};

export const buildIndexProfileState = (profileId) => ({
  id: assertKnownIndexProfileId(profileId, 'profile.id'),
  schemaVersion: INDEX_PROFILE_SCHEMA_VERSION
});

/**
 * Resolve required artifact names for a profile id.
 *
 * @param {unknown} profileId
 * @returns {string[]}
 */
export const resolveRequiredArtifactsForProfile = (profileId) => {
  const resolved = normalizeIndexProfileId(profileId, INDEX_PROFILE_DEFAULT);
  return [...(REQUIRED_ARTIFACTS_BY_PROFILE[resolved] || REQUIRED_ARTIFACTS_BY_PROFILE[INDEX_PROFILE_DEFAULT])];
};
