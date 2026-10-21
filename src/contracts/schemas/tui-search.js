const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

/** Internal operator envelope; search predicates retain their canonical API schema. */
export const TUI_SEARCH_REQUEST_SCHEMAS = {
  dispatch: record({ proto: { const: 'poc.tui@1' }, op: { const: 'search:run' },
    jobId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
    method: { enum: ['describe', 'query', 'continue', 'source', 'open'] }, params: { type: 'object' } }),
  describe: record({}),
  query: record({ repoPath: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^[^\\u0000]+$' },
    search: { type: 'object' } }),
  continue: record({ resultId: id }),
  source: record({ resultId: id, hitId: { type: 'string', pattern: '^[0-9a-f]{64}$' } }),
  open: record({ resultId: id, hitId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    editor: { const: 'code' }, confirmed: { const: true }, sourceHash: { type: 'string', pattern: '^sha1:[0-9a-f]{40}$' } })
};
