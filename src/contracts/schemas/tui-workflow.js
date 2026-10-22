const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
export const TUI_WORKFLOW_REQUEST_SCHEMAS = {
  dispatch: record({ proto: { const: 'poc.tui@1' }, op: { const: 'workflow:run' },
    jobId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
    method: { enum: ['select', 'describe', 'preview', 'launch', 'discard', 'status'] }, params: { type: 'object' } }),
  select: record({ kind: { enum: ['repo', 'workspace'] }, target: { type: 'string', minLength: 1, maxLength: 4096 } }),
  describe: { ...record({ includeExperimental: { type: 'boolean' } }), required: [] },
  preview: record({ scopeId: id, commandId: { type: 'string', minLength: 1, maxLength: 128 },
    values: { type: 'object', maxProperties: 64 } }),
  launch: record({ scopeId: id, previewId: id, confirmed: { const: true } }),
  discard: record({ scopeId: id, previewId: id }),
  status: record({ scopeId: id })
};
