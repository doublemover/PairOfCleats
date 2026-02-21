export const WORKSPACE_CONFIG_RESOLVED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'workspace-config-resolved',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'workspacePath',
    'workspaceDir',
    'name',
    'cacheRoot',
    'defaults',
    'repos',
    'repoSetId',
    'workspaceConfigHash'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    workspacePath: { type: 'string' },
    workspaceDir: { type: 'string' },
    name: { type: 'string' },
    cacheRoot: { type: ['string', 'null'] },
    defaults: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'priority', 'tags'],
      properties: {
        enabled: { type: 'boolean' },
        priority: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    },
    repos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'repoId',
          'repoRootResolved',
          'repoRootCanonical',
          'alias',
          'tags',
          'enabled',
          'priority',
          'rootInput',
          'rootAbs',
          'index'
        ],
        properties: {
          repoId: { type: 'string' },
          repoRootResolved: { type: 'string' },
          repoRootCanonical: { type: 'string' },
          alias: { type: ['string', 'null'] },
          tags: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean' },
          priority: { type: 'integer' },
          rootInput: { type: 'string' },
          rootAbs: { type: 'string' },
          index: { type: 'integer' }
        }
      }
    },
    repoSetId: { type: 'string' },
    workspaceConfigHash: { type: 'string' }
  }
};

export const WORKSPACE_MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'workspace-manifest',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'repoSetId',
    'manifestHash',
    'federationCacheRoot',
    'workspace',
    'repos',
    'diagnostics'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    repoSetId: { type: 'string' },
    manifestHash: { type: 'string' },
    federationCacheRoot: { type: 'string' },
    workspace: {
      type: 'object',
      additionalProperties: false,
      required: ['workspacePath', 'name', 'workspaceConfigHash'],
      properties: {
        workspacePath: { type: 'string' },
        name: { type: 'string' },
        workspaceConfigHash: { type: ['string', 'null'] }
      }
    },
    repos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: [
          'repoId',
          'repoRootCanonical',
          'repoCacheRoot',
          'build',
          'indexes',
          'sqlite'
        ],
        properties: {
          repoId: { type: 'string' },
          repoRootCanonical: { type: 'string' },
          repoCacheRoot: { type: 'string' },
          build: { type: 'object' },
          indexes: { type: 'object' },
          sqlite: { type: 'object' }
        }
      }
    },
    diagnostics: {
      type: 'object',
      additionalProperties: false,
      required: ['warnings', 'errors'],
      properties: {
        warnings: { type: 'array' },
        errors: { type: 'array' }
      }
    }
  }
};

export const WORKSPACE_SCHEMA_DEFS = Object.freeze({
  workspaceConfigResolved: WORKSPACE_CONFIG_RESOLVED_SCHEMA,
  workspaceManifest: WORKSPACE_MANIFEST_SCHEMA
});
