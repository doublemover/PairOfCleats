const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const jobId = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const selection = { sourceJobId: jobId, inventoryId: id, artifactId: id };

/** Internal selections carry opaque collector identities, never source paths. */
export const TUI_ARTIFACT_REQUEST_SCHEMAS = {
  dispatch: record({ proto: { const: 'poc.tui@1' }, op: { const: 'artifact:run' }, jobId,
    method: { enum: ['open', 'copy', 'export'] }, params: { type: 'object' } }),
  open: record({ ...selection, confirmed: { const: true } }),
  copy: record(selection),
  export: record({ ...selection, confirmed: { const: true },
    destination: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^[^\\u0000-\\u001f\\u007f]+$' } })
};
