const FAMILY_CAPABILITIES = Object.freeze([
  {
    family: 'artifact-stats',
    owner: 'artifacts-write',
    laneHint: 'ultraLight',
    streamability: 'monolithic',
    shardability: 'monolithic',
    progressUnit: 'files'
  },
  {
    family: 'dense-vectors',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'monolithic',
    shardability: 'monolithic',
    progressUnit: 'vectors'
  },
  {
    family: 'file-meta',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'files'
  },
  {
    family: 'chunk-meta',
    owner: 'artifacts-write',
    laneHint: 'massive',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'chunks',
    exclusivePublisherFamily: 'chunk-meta-binary-columnar'
  },
  {
    family: 'identity-support',
    owner: 'artifacts-write',
    laneHint: 'light',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'chunks'
  },
  {
    family: 'vfs-manifest',
    owner: 'artifacts-write',
    laneHint: 'light',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'files'
  },
  {
    family: 'repo-analysis',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'chunks'
  },
  {
    family: 'minhash-postings',
    owner: 'artifacts-write',
    laneHint: 'light',
    streamability: 'streamable',
    shardability: 'monolithic',
    progressUnit: 'signatures'
  },
  {
    family: 'token-postings',
    owner: 'artifacts-write',
    laneHint: 'massive',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'tokens',
    exclusivePublisherFamily: 'token-postings'
  },
  {
    family: 'fielded-postings',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'tokens'
  },
  {
    family: 'field-postings',
    owner: 'artifacts-write',
    laneHint: 'massive',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'fields',
    exclusivePublisherFamily: 'field-postings'
  },
  {
    family: 'file-relations',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'relations'
  },
  {
    family: 'risk-interprocedural',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'flows'
  },
  {
    family: 'symbols',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'symbols'
  },
  {
    family: 'symbol-occurrences',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'occurrences'
  },
  {
    family: 'symbol-edges',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'edges'
  },
  {
    family: 'graph-relations',
    owner: 'artifacts-write',
    laneHint: 'heavy',
    streamability: 'streamable',
    shardability: 'shardable',
    progressUnit: 'edges'
  },
  {
    family: 'phrase-ngrams',
    owner: 'artifacts-write',
    laneHint: 'light',
    streamability: 'monolithic',
    shardability: 'monolithic',
    progressUnit: 'ngrams'
  },
  {
    family: 'chargram-postings',
    owner: 'artifacts-write',
    laneHint: 'light',
    streamability: 'monolithic',
    shardability: 'monolithic',
    progressUnit: 'ngrams'
  }
]);

const CAPABILITY_BY_FAMILY = new Map(
  FAMILY_CAPABILITIES.map((entry) => [entry.family, Object.freeze({ ...entry })])
);

const normalizeFamilyName = (family) => (
  typeof family === 'string' ? family.trim().toLowerCase() : ''
);

export const listArtifactPublicationFamilyCapabilities = () => FAMILY_CAPABILITIES.slice();

export const resolveArtifactPublicationFamilyCapability = (family) => (
  CAPABILITY_BY_FAMILY.get(normalizeFamilyName(family)) || null
);

export const applyArtifactPublicationFamilyMeta = (family, meta = {}) => {
  const capability = resolveArtifactPublicationFamilyCapability(family);
  const normalizedFamily = normalizeFamilyName(family);
  const nextMeta = { ...meta };
  if (normalizedFamily && !nextMeta.family) {
    nextMeta.family = normalizedFamily;
  }
  if (capability) {
    nextMeta.familyCapability = capability;
    if (!nextMeta.laneHint && capability.laneHint) {
      nextMeta.laneHint = capability.laneHint;
    }
    if (!nextMeta.progressUnit && capability.progressUnit) {
      nextMeta.progressUnit = capability.progressUnit;
    }
    if (!nextMeta.exclusivePublisherFamily && capability.exclusivePublisherFamily) {
      nextMeta.exclusivePublisherFamily = capability.exclusivePublisherFamily;
    }
  }
  return nextMeta;
};
