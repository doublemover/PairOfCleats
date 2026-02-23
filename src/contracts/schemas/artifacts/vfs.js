const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };

const vfsManifestRow = {
  type: 'object',
  required: [
    'schemaVersion',
    'virtualPath',
    'docHash',
    'containerPath',
    'containerExt',
    'containerLanguageId',
    'languageId',
    'effectiveExt',
    'segmentUid',
    'segmentStart',
    'segmentEnd'
  ],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    docHash: { type: 'string' },
    containerPath: { type: 'string' },
    containerExt: nullableString,
    containerLanguageId: nullableString,
    languageId: { type: 'string' },
    effectiveExt: { type: 'string' },
    segmentUid: nullableString,
    segmentId: nullableString,
    segmentStart: intId,
    segmentEnd: intId,
    lineStart: { type: ['integer', 'null'], minimum: 0 },
    lineEnd: { type: ['integer', 'null'], minimum: 0 },
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const vfsPathMapRow = {
  type: 'object',
  required: [
    'schemaVersion',
    'virtualPath',
    'hashVirtualPath',
    'containerPath',
    'segmentUid',
    'segmentStart',
    'segmentEnd',
    'effectiveExt',
    'languageId',
    'docHash'
  ],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    hashVirtualPath: { type: 'string' },
    containerPath: { type: 'string' },
    segmentUid: nullableString,
    segmentStart: intId,
    segmentEnd: intId,
    effectiveExt: { type: 'string' },
    languageId: { type: 'string' },
    docHash: { type: 'string' }
  },
  additionalProperties: false
};

const vfsManifestIndexRow = {
  type: 'object',
  required: ['schemaVersion', 'virtualPath', 'offset', 'bytes'],
  properties: {
    schemaVersion: { type: 'string' },
    virtualPath: { type: 'string' },
    offset: intId,
    bytes: intId
  },
  additionalProperties: false
};

const vfsManifestBloom = {
  type: 'object',
  required: ['schemaVersion', 'algorithm', 'bits', 'hashes', 'count', 'bytes'],
  properties: {
    schemaVersion: { type: 'string' },
    algorithm: { type: 'string' },
    bits: intId,
    hashes: intId,
    count: intId,
    bytes: { type: 'string' }
  },
  additionalProperties: false
};

const chunkUidMapRow = {
  type: 'object',
  required: ['docId', 'chunkUid', 'chunkId', 'file', 'start', 'end'],
  properties: {
    docId: intId,
    chunkUid: { type: 'string' },
    chunkId: { type: 'string' },
    file: { type: 'string' },
    segmentUid: nullableString,
    segmentId: nullableString,
    start: intId,
    end: intId,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

export const VFS_ARTIFACT_SCHEMA_DEFS = {
  chunk_uid_map: {
    type: 'array',
    items: chunkUidMapRow
  },
  vfs_manifest: {
    type: 'array',
    items: vfsManifestRow
  },
  vfs_path_map: {
    type: 'array',
    items: vfsPathMapRow
  },
  vfs_manifest_index: {
    type: 'array',
    items: vfsManifestIndexRow
  },
  vfs_manifest_bloom: vfsManifestBloom
};
