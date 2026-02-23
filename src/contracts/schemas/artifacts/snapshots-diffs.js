const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableBool = { type: ['boolean', 'null'] };
const posInt = { type: 'integer', minimum: 1 };
const modeName = { type: 'string', enum: ['code', 'prose', 'extracted-prose', 'records'] };
const modeList = { type: 'array', items: modeName };
const snapshotIdString = { type: 'string', pattern: '^snap-[A-Za-z0-9._-]+$' };
const diffIdString = { type: 'string', pattern: '^diff_[A-Za-z0-9._-]+$' };

const snapshotSummaryEntry = {
  type: 'object',
  required: ['snapshotId', 'createdAt', 'kind', 'tags', 'hasFrozen'],
  properties: {
    snapshotId: snapshotIdString,
    createdAt: { type: 'string' },
    kind: { type: 'string', enum: ['pointer', 'frozen'] },
    tags: { type: 'array', items: { type: 'string' } },
    label: nullableString,
    hasFrozen: { type: 'boolean' }
  },
  additionalProperties: true
};

const snapshotPointerSchema = {
  type: 'object',
  required: ['buildRootsByMode', 'buildIdByMode'],
  properties: {
    buildRootsByMode: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    buildIdByMode: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  },
  additionalProperties: false
};

const snapshotGitProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    branch: nullableString,
    commit: nullableString,
    dirty: nullableBool
  },
  additionalProperties: false
};

const snapshotProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    repoId: nullableString,
    repoRootHash: nullableString,
    git: snapshotGitProvenanceSchema,
    toolVersionByMode: {
      type: ['object', 'null'],
      additionalProperties: nullableString
    },
    configHashByMode: {
      type: ['object', 'null'],
      additionalProperties: nullableString
    }
  },
  additionalProperties: true
};

const diffRefSchema = {
  type: 'object',
  properties: {
    snapshotId: nullableString,
    buildId: nullableString,
    indexRootRef: nullableString,
    ref: nullableString
  },
  additionalProperties: true
};

const diffManifestEntry = {
  type: 'object',
  required: ['id', 'createdAt', 'from', 'to', 'modes', 'summaryPath'],
  properties: {
    id: diffIdString,
    createdAt: { type: 'string' },
    from: diffRefSchema,
    to: diffRefSchema,
    modes: modeList,
    summaryPath: { type: 'string' },
    eventsPath: nullableString,
    truncated: { type: 'boolean' },
    maxEvents: nullableInt,
    maxBytes: nullableInt,
    compat: {
      type: ['object', 'null'],
      additionalProperties: true
    }
  },
  additionalProperties: true
};

export const SNAPSHOT_DIFF_ARTIFACT_SCHEMA_DEFS = {
  snapshots_manifest: {
    type: 'object',
    required: ['version', 'updatedAt', 'snapshots', 'tags'],
    properties: {
      version: posInt,
      updatedAt: { type: 'string' },
      snapshots: {
        type: 'object',
        additionalProperties: snapshotSummaryEntry
      },
      tags: {
        type: 'object',
        additionalProperties: {
          type: 'array',
          items: snapshotIdString
        }
      }
    },
    additionalProperties: false
  },
  snapshot_record: {
    type: 'object',
    required: ['version', 'snapshotId', 'createdAt', 'kind', 'tags', 'pointer'],
    properties: {
      version: posInt,
      snapshotId: snapshotIdString,
      createdAt: { type: 'string' },
      kind: { type: 'string', enum: ['pointer', 'frozen'] },
      label: nullableString,
      notes: nullableString,
      tags: { type: 'array', items: { type: 'string' } },
      pointer: snapshotPointerSchema,
      provenance: snapshotProvenanceSchema
    },
    additionalProperties: false
  },
  snapshot_frozen: {
    type: 'object',
    required: ['version', 'snapshotId', 'frozenAt', 'method', 'frozenRoot', 'included', 'verification'],
    properties: {
      version: posInt,
      snapshotId: snapshotIdString,
      frozenAt: { type: 'string' },
      method: { type: 'string' },
      frozenRoot: { type: 'string' },
      included: {
        type: 'object',
        required: ['modes', 'sqlite', 'lmdb'],
        properties: {
          modes: modeList,
          sqlite: { type: 'boolean' },
          lmdb: { type: 'boolean' }
        },
        additionalProperties: false
      },
      verification: {
        type: 'object',
        required: ['checkedAt', 'ok'],
        properties: {
          checkedAt: { type: 'string' },
          ok: { type: 'boolean' },
          filesChecked: nullableInt,
          bytesChecked: nullableInt,
          failures: { type: ['array', 'null'], items: { type: 'string' } }
        },
        additionalProperties: true
      }
    },
    additionalProperties: false
  },
  diffs_manifest: {
    type: 'object',
    required: ['version', 'updatedAt', 'diffs'],
    properties: {
      version: posInt,
      updatedAt: { type: 'string' },
      diffs: {
        type: 'object',
        additionalProperties: diffManifestEntry
      }
    },
    additionalProperties: false
  },
  diff_inputs: {
    type: 'object',
    required: ['id', 'createdAt', 'from', 'to', 'modes', 'allowMismatch', 'identityHash'],
    properties: {
      id: diffIdString,
      createdAt: { type: 'string' },
      from: diffRefSchema,
      to: diffRefSchema,
      modes: modeList,
      allowMismatch: { type: 'boolean' },
      identityHash: { type: 'string' },
      fromConfigHash: nullableString,
      toConfigHash: nullableString,
      fromToolVersion: nullableString,
      toToolVersion: nullableString
    },
    additionalProperties: true
  },
  diff_summary: {
    type: 'object',
    required: ['id', 'createdAt', 'from', 'to', 'modes'],
    properties: {
      id: diffIdString,
      createdAt: { type: 'string' },
      from: diffRefSchema,
      to: diffRefSchema,
      modes: modeList,
      truncated: { type: 'boolean' },
      limits: {
        type: ['object', 'null'],
        additionalProperties: true
      },
      totals: {
        type: ['object', 'null'],
        additionalProperties: true
      }
    },
    additionalProperties: true
  }
};
