const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object', additionalProperties: false, properties, required
});
export const TUI_RECORDING_REQUEST_SCHEMAS = {
  dispatch: record({ proto: { const: 'poc.tui@1' }, op: { const: 'recording:run' },
    jobId: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' },
    method: { enum: ['list', 'load', 'page', 'discard'] }, params: { type: 'object' } }),
  list: record({ directory: { type: 'string', minLength: 1, maxLength: 4096 },
    filename: { type: 'string', minLength: 1, maxLength: 206 } }, ['directory']),
  load: record({ directoryId: id, entryId: id }),
  page: record({ recordingId: id, offset: { type: 'integer', minimum: 0, maximum: 32768 },
    count: { type: 'integer', minimum: 1, maximum: 128 } }, ['recordingId']),
  discard: record({ recordingId: id })
};
