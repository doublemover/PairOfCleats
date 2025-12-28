/**
 * Build MCP tool definitions for the server.
 * @param {string} defaultModelId
 * @returns {Array<object>}
 */
export function getToolDefs(defaultModelId) {
  return [
    {
      name: 'index_status',
      description: 'Return cache and index status for a repo path.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' }
        }
      }
    },
    {
      name: 'build_index',
      description: 'Build or update indexes for a repo (optionally SQLite + incremental).',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          mode: { type: 'string', enum: ['all', 'code', 'prose'] },
          sqlite: { type: 'boolean', description: 'Build SQLite indexes after JSON indexes.' },
          incremental: { type: 'boolean', description: 'Reuse per-file incremental cache.' },
          stubEmbeddings: { type: 'boolean', description: 'Skip model downloads and use stub embeddings.' },
          useArtifacts: { type: 'boolean', description: 'Restore CI artifacts before building.' },
          artifactsDir: { type: 'string', description: 'Path to CI artifacts directory.' }
        }
      }
    },
    {
      name: 'search',
      description: 'Run a search query against the repo index.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          query: { type: 'string' },
          mode: { type: 'string', enum: ['both', 'code', 'prose'] },
          backend: { type: 'string', enum: ['memory', 'sqlite', 'sqlite-fts'] },
          ann: { type: 'boolean', description: 'Enable ANN re-ranking (default uses config).' },
          top: { type: 'number', description: 'Top N results.' },
          context: { type: 'number', description: 'Context lines.' }
        },
        required: ['query']
      }
    },
    {
      name: 'download_models',
      description: 'Download embedding models into the shared cache.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          model: { type: 'string', description: `Model id (default ${defaultModelId}).` },
          cacheDir: { type: 'string', description: 'Override cache directory.' }
        }
      }
    },
    {
      name: 'report_artifacts',
      description: 'Report current artifact sizes for the repo and cache root.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' }
        }
      }
    }
  ];
}
