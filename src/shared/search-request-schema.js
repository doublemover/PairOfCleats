import { INTEGER_MIN_ZERO_FLAG_FIELDS, REPEATED_LIST_FIELDS, STRING_FLAG_FIELDS } from './search-request.js';

export const createSearchStringListSchema = () => ({
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
});

/** Value domains shared by HTTP and MCP. Descriptions, the HTTP repo alias and
 * transport output modes are intentional surface differences, not new filters.
 * Return fresh schemas so one consumer cannot mutate another's declarations.
 */
export const buildSearchRequestProperties = ({ includeRepoAlias = false,
  outputs = ['compact', 'json', 'full'], descriptions = {} } = {}) => {
  const properties = {
    query: { type: 'string' }, repoPath: { type: 'string' },
    ...(includeRepoAlias ? { repo: { type: 'string' } } : {}),
    asOf: { type: 'string' }, snapshot: { type: 'string' }, snapshotId: { type: 'string' },
    cursor: { type: 'string', minLength: 1, maxLength: 8192 },
    output: { type: 'string', enum: [...outputs] },
    mode: { type: 'string', enum: ['code', 'prose', 'records', 'both', 'all', 'extracted-prose'] },
    backend: { type: 'string', enum: ['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb'] },
    top: { type: 'integer', minimum: 0 },
    context: { type: 'integer', const: 0, deprecated: true },
    ...Object.fromEntries(STRING_FLAG_FIELDS.map(([field]) => [field, { type: 'string' }])),
    ...Object.fromEntries(INTEGER_MIN_ZERO_FLAG_FIELDS.map(([field]) => [field, { type: 'integer', minimum: 0 }])),
    ...Object.fromEntries(['ann', 'allowSparseFallback', 'allowUnsafeMix', 'lint', 'async', 'generator',
      'returns', 'case', 'caseFile', 'caseTokens'].map(field => [field, { type: 'boolean' }])),
    path: createSearchStringListSchema(), paths: createSearchStringListSchema(),
    ...Object.fromEntries(REPEATED_LIST_FIELDS.map(([field]) => [field, createSearchStringListSchema()])),
    meta: { anyOf: [{ type: 'string' }, { type: 'array', items: { anyOf: [
      { type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'object' }, { type: 'null' }
    ] } }, { type: 'object', additionalProperties: true }] },
    metaJson: { type: ['string', 'object', 'array', 'number', 'boolean', 'null'] }
  };
  for (const [field, description] of Object.entries(descriptions)) {
    if (!Object.hasOwn(properties, field)) throw new TypeError(`Unknown shared search schema description: ${field}`);
    properties[field].description = description;
  }
  return properties;
};
