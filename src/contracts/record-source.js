export const RECORD_SOURCE_VERSION = 1;
export const RECORD_SOURCE_PREFIX = '.record-sources/v1/';

export const RECORD_SOURCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'kind', 'repositoryKey', 'rootKey', 'relativePath', 'storagePath', 'displayPath', 'contentHash', 'hashAlgo'],
  properties: {
    schemaVersion: { const: RECORD_SOURCE_VERSION }, kind: { enum: ['repository', 'triage'] },
    repositoryKey: { type: 'string', pattern: '^rr1-[a-f0-9]{64}$' }, rootKey: { type: 'string', pattern: '^rs1-[a-f0-9]{64}$' },
    relativePath: { type: 'string', minLength: 1 }, storagePath: { type: 'string', minLength: 1 },
    displayPath: { type: 'string', minLength: 1 }, contentHash: { type: 'string', pattern: '^[a-f0-9]{40}$' }, hashAlgo: { const: 'sha1' }
  }
};
