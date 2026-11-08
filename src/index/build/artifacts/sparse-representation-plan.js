const admittedPlans = new WeakSet();

/** Packed postings already carry the vocabulary, document lengths, term
 * frequencies and bounded decode offsets consumed by retrieval, validation,
 * SQLite ingestion and piece assembly. Their optional binary duplicate adds no
 * required content. Explicit compatibility requests continue to produce it.
 * JSON/sharded primaries retain the current binary acceleration path pending
 * independent read-cost qualification; chunk-meta planning is unchanged.
 */
export const planTokenPostingsRepresentations = ({ primary, binaryColumnar, requireBinaryColumnar = false }) => {
  if (!['packed', 'json', 'sharded'].includes(primary)) throw new TypeError('Unsupported primary token-postings layout.');
  if (requireBinaryColumnar && !binaryColumnar) throw new TypeError('Required binary token-postings compatibility cannot be disabled.');
  const emitBinaryColumnar = binaryColumnar === true && (primary !== 'packed' || requireBinaryColumnar);
  const plan = Object.freeze({ schemaVersion: 1, family: 'token-postings', primary,
    emitBinaryColumnar,
    compatibility: Object.freeze(emitBinaryColumnar ? ['binary-columnar-v1'] : []),
    compatibilityReason: !emitBinaryColumnar ? null : requireBinaryColumnar ? 'explicit-request' : 'existing-read-acceleration',
    consumers: Object.freeze(['retrieval', 'validation', 'sqlite-ingestion', 'piece-assembly', 'manifest-bundle']) });
  admittedPlans.add(plan);
  return plan;
};

export const assertTokenPostingsRepresentationPlan = (plan, primary) => {
  if (!admittedPlans.has(plan) || plan.primary !== primary) throw new TypeError('Token-postings representation plan does not match the primary layout.');
  return plan;
};

/** Existing supported primaries remain canonical. No caller is migrated to a
 * binary-only generation: SQLite, retrieval, validation and piece assembly all
 * consume these primaries already. Explicit binary requests and the established
 * small JSON compatibility export remain part of the required output plan.
 */
export const planChunkMetaRepresentations = ({ primary, binaryColumnar = false, requireBinaryColumnar = false,
  legacyJson = false, hotColdSplit = false }) => {
  if (!['json', 'jsonl', 'columnar'].includes(primary)) throw new TypeError('Unsupported primary chunk-metadata layout.');
  if (requireBinaryColumnar && !binaryColumnar) {
    throw Object.assign(new Error('Required chunk-metadata binary compatibility exceeds the admitted representation limits.'),
      { code: 'ERR_CHUNK_META_COMPATIBILITY_LIMIT' });
  }
  const compatibility = [...(requireBinaryColumnar ? ['binary-columnar-v1'] : []), ...(legacyJson ? ['json-array'] : [])];
  return Object.freeze({ schemaVersion: 1, family: 'chunk-meta', primary,
    emitBinaryColumnar: requireBinaryColumnar, hotColdSplit: primary === 'jsonl' && hotColdSplit,
    compatibility: Object.freeze(compatibility),
    consumers: Object.freeze(['retrieval', 'validation', 'sqlite-ingestion', 'piece-assembly', 'manifest-bundle']) });
};
