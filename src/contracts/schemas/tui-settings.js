const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const revision = { type: 'string', pattern: '^(missing|sha256:[0-9a-f]{64})$' };
const schemaRevision = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, properties, required
});
const previewBase = { scopeId: id, revision, schemaRevision };

/** Internal native TUI requests; these add no CLI or repository configuration knobs. */
export const TUI_SETTINGS_REQUEST_SCHEMAS = {
  dispatch: record({ proto: { type: 'string' }, op: { const: 'settings:run' },
    jobId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
    method: { enum: ['select', 'inspect', 'preview', 'commit', 'cancel'] }, params: { type: 'object' } }),
  select: record({ kind: { enum: ['repo', 'workspace'] }, target: { type: 'string', minLength: 1, maxLength: 4096 } }),
  inspect: record({ scopeId: id }),
  preview: { oneOf: [
    record({ ...previewBase, operation: { const: 'edit' },
      path: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 128 } }, value: {} }),
    record({ ...previewBase, operation: { const: 'reset' } })
  ] },
  commit: record({ scopeId: id, previewId: id, confirmed: { type: 'boolean' },
    resetConfirmation: { type: 'string', maxLength: 64 } }, ['scopeId', 'previewId']),
  cancel: record({ scopeId: id, previewId: id })
};
