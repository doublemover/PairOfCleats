const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const BATCH_SHARD_ID_ORDER = Object.freeze(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
const REQUIRED_BATCH_SHARD_IDS = Object.freeze(new Set(BATCH_SHARD_ID_ORDER));
const LANGUAGE_BATCH_IDS = Object.freeze(new Set(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']));
const BATCH_SEQUENCE_SHARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    laneId: 'conformance-shard-foundation',
    orderManifest: 'tests/conformance/language-shards/foundation/foundation.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-javascript-typescript',
    orderManifest: 'tests/conformance/language-shards/javascript-typescript/javascript-typescript.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-systems-languages',
    orderManifest: 'tests/conformance/language-shards/systems-languages/systems-languages.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-managed-languages',
    orderManifest: 'tests/conformance/language-shards/managed-languages/managed-languages.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-dynamic-languages',
    orderManifest: 'tests/conformance/language-shards/dynamic-languages/dynamic-languages.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-markup-style-template',
    orderManifest: 'tests/conformance/language-shards/markup-style-template/markup-style-template.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-data-interface-dsl',
    orderManifest: 'tests/conformance/language-shards/data-interface-dsl/data-interface-dsl.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-build-infra-dsl',
    orderManifest: 'tests/conformance/language-shards/build-infra-dsl/build-infra-dsl.order.txt'
  }),
  Object.freeze({
    laneId: 'conformance-shard-cross-language-integration',
    orderManifest: 'tests/conformance/language-shards/cross-language-integration/cross-language-integration.order.txt'
  })
]);
const BATCH_DEPENDENCIES = Object.freeze({
  B0: [],
  B1: ['B0'],
  B2: ['B1'],
  B3: ['B1'],
  B4: ['B1'],
  B5: ['B1'],
  B6: ['B1'],
  B7: ['B1'],
  B8: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']
});

const emptyValidationResult = (errors) => ({
  ok: false,
  errors: Object.freeze([...errors]),
  warnings: Object.freeze([]),
  rows: Object.freeze([])
});

const sortedStrings = (value) => [...asStringArray(value)].sort((left, right) => left.localeCompare(right));

const equalStringSets = (left, right) => {
  const leftSorted = sortedStrings(left);
  const rightSorted = sortedStrings(right);
  if (leftSorted.length !== rightSorted.length) {
    return false;
  }
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

/**
 * Validates canonical language-batch shard layout and language coverage mapping.
 *
 * @param {object} [input]
 * @param {object} [input.batchShardsPayload]
 * @param {object} [input.languageProfilesPayload]
 * @param {(registryId:string,payload:unknown)=>{ok:boolean,errors?:string[]}} input.validateRegistry
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,rows:ReadonlyArray<object>}}
 */
export function validateUsrLanguageBatchShards({
  batchShardsPayload,
  languageProfilesPayload,
  validateRegistry
} = {}) {
  if (typeof validateRegistry !== 'function') {
    return emptyValidationResult(['validateRegistry callback is required']);
  }

  const batchValidation = validateRegistry('usr-language-batch-shards', batchShardsPayload);
  if (!batchValidation?.ok) {
    return emptyValidationResult(batchValidation?.errors || ['invalid usr-language-batch-shards payload']);
  }

  const languageValidation = validateRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation?.ok) {
    return emptyValidationResult(languageValidation?.errors || ['invalid usr-language-profiles payload']);
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const shardRows = Array.isArray(batchShardsPayload?.rows) ? batchShardsPayload.rows : [];
  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];

  const languageIds = new Set(languageRows.map((row) => row.id));
  const batchById = new Map();
  const laneIdCounts = new Map();
  const sequenceCounts = new Map();
  const languageToBatch = new Map();

  for (const row of shardRows) {
    laneIdCounts.set(row.laneId, (laneIdCounts.get(row.laneId) || 0) + 1);
    sequenceCounts.set(row.sequence, (sequenceCounts.get(row.sequence) || 0) + 1);
  }

  for (const row of shardRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if (batchById.has(row.id)) {
      rowErrors.push('batch shard id must be unique');
    }
    batchById.set(row.id, row);

    const expectedShardDefinition = BATCH_SEQUENCE_SHARD_DEFINITIONS[row.sequence];
    const expectedLaneId = expectedShardDefinition?.laneId || `conformance-shard-b${row.sequence}`;
    if (row.laneId !== expectedLaneId) {
      rowErrors.push(`laneId must match sequence mapping: expected ${expectedLaneId}`);
    }

    const expectedOrderManifest = expectedShardDefinition?.orderManifest
      || `tests/${row.laneId}/${row.laneId}.order.txt`;
    if (row.orderManifest !== expectedOrderManifest) {
      rowErrors.push(`orderManifest must match lane path: expected ${expectedOrderManifest}`);
    }

    if ((laneIdCounts.get(row.laneId) || 0) > 1) {
      rowErrors.push('laneId must be unique');
    }

    if ((sequenceCounts.get(row.sequence) || 0) > 1) {
      rowErrors.push('sequence must be unique');
    }

    if (!REQUIRED_BATCH_SHARD_IDS.has(row.id)) {
      rowErrors.push(`unexpected batch shard id: ${row.id}`);
    }

    const expectedDependencies = BATCH_DEPENDENCIES[row.id] || [];
    if (!equalStringSets(row.dependsOn, expectedDependencies)) {
      rowErrors.push(`dependsOn must match canonical dependency set: ${expectedDependencies.join(', ') || '<none>'}`);
    }

    const expectedScopeType = row.id === 'B0'
      ? 'foundation'
      : (row.id === 'B8' ? 'integration' : 'language-batch');
    if (row.scopeType !== expectedScopeType) {
      rowErrors.push(`scopeType must be ${expectedScopeType} for ${row.id}`);
    }

    const sortedLanguageIds = sortedStrings(row.languageIds);
    const rawLanguageIds = asStringArray(row.languageIds);
    if (sortedLanguageIds.length !== rawLanguageIds.length || !sortedLanguageIds.every((value, index) => value === rawLanguageIds[index])) {
      rowErrors.push('languageIds must be sorted ascending for deterministic manifests');
    }

    if (LANGUAGE_BATCH_IDS.has(row.id) && sortedLanguageIds.length === 0) {
      rowErrors.push('language batch shard must declare at least one language id');
    }

    if ((row.id === 'B0' || row.id === 'B8') && sortedLanguageIds.length > 0) {
      rowErrors.push('B0 and B8 shards must not enumerate languageIds directly');
    }

    for (const languageId of sortedLanguageIds) {
      if (!languageIds.has(languageId)) {
        rowErrors.push(`unknown language id in shard: ${languageId}`);
        continue;
      }
      const owner = languageToBatch.get(languageId);
      if (owner && owner !== row.id) {
        rowErrors.push(`language id assigned to multiple shards: ${languageId} (existing ${owner})`);
      } else {
        languageToBatch.set(languageId, row.id);
      }
    }

    if (asStringArray(row.requiredConformance).length === 0) {
      rowWarnings.push('requiredConformance should include at least one level');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      sequence: row.sequence,
      scopeType: row.scopeType,
      languageCount: sortedLanguageIds.length,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const requiredId of REQUIRED_BATCH_SHARD_IDS) {
    if (!batchById.has(requiredId)) {
      errors.push(`missing required batch shard id: ${requiredId}`);
    }
  }

  for (const languageId of languageIds) {
    if (!languageToBatch.has(languageId)) {
      errors.push(`language profile is missing from batch shard mapping: ${languageId}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}
