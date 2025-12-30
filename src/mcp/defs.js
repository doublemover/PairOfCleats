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
      name: 'config_status',
      description: 'Inspect configuration and cache status, with warnings.',
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
          mode: { type: 'string', enum: ['all', 'code', 'prose', 'records'] },
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
          mode: { type: 'string', enum: ['both', 'code', 'prose', 'records', 'all'] },
          backend: { type: 'string', enum: ['memory', 'sqlite', 'sqlite-fts'] },
          ann: { type: 'boolean', description: 'Enable ANN re-ranking (default uses config).' },
          top: { type: 'number', description: 'Top N results.' },
          context: { type: 'number', description: 'Context lines.' },
          file: { type: 'string', description: 'Substring match for file paths.' },
          ext: { type: 'string', description: 'Extension filter (ex: .js).' },
          meta: { type: 'object', description: 'Metadata filters for records (key/value).' },
          metaJson: { type: 'string', description: 'JSON metadata filters for records.' }
        },
        required: ['query']
      }
    },
    {
      name: 'triage_ingest',
      description: 'Ingest vulnerability findings into triage records.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          source: { type: 'string', enum: ['dependabot', 'aws_inspector', 'generic', 'manual'] },
          inputPath: { type: 'string', description: 'Input JSON/JSONL file.' },
          meta: { type: 'object', description: 'Routing metadata (service/env/team/owner/etc).' },
          buildIndex: { type: 'boolean', description: 'Build the records index after ingest.' },
          incremental: { type: 'boolean', description: 'Use incremental indexing if enabled.' },
          stubEmbeddings: { type: 'boolean', description: 'Use stub embeddings for indexing.' }
        },
        required: ['source', 'inputPath']
      }
    },
    {
      name: 'triage_decision',
      description: 'Create a triage decision record linked to a finding.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          finding: { type: 'string', description: 'Finding record id.' },
          status: { type: 'string', enum: ['fix', 'accept', 'defer', 'false_positive', 'not_affected'] },
          justification: { type: 'string' },
          reviewer: { type: 'string' },
          expires: { type: 'string', description: 'ISO date for expiry.' },
          meta: { type: 'object', description: 'Additional routing metadata.' },
          codes: { type: 'array', items: { type: 'string' }, description: 'Justification codes.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence references.' }
        },
        required: ['finding', 'status']
      }
    },
    {
      name: 'triage_context_pack',
      description: 'Generate a triage context pack for a finding.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          recordId: { type: 'string', description: 'Finding record id.' },
          outPath: { type: 'string', description: 'Output file path.' },
          ann: { type: 'boolean', description: 'Enable ANN search for evidence.' },
          stubEmbeddings: { type: 'boolean', description: 'Use stub embeddings for evidence search.' }
        },
        required: ['recordId']
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
