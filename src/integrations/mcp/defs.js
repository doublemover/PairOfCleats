import { getToolVersion } from '../../shared/dict-utils.js';

export const MCP_SCHEMA_VERSION = '1.0.0';

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
          mode: { type: 'string', enum: ['all', 'code', 'prose', 'extracted-prose', 'records'] },
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
          mode: { type: 'string', enum: ['both', 'code', 'prose', 'extracted-prose', 'records', 'all'] },
          backend: { type: 'string', enum: ['memory', 'sqlite', 'sqlite-fts'] },
          output: { type: 'string', enum: ['compact', 'full'], description: 'Return compact JSON (default) or full payload.' },
          ann: { type: 'boolean', description: 'Enable ANN re-ranking (default uses config).' },
          top: { type: 'number', description: 'Top N results.' },
          context: { type: 'number', description: 'Context lines.' },
          type: { type: 'string', description: 'Filter by chunk kind/type.' },
          author: { type: 'string', description: 'Filter by last author (git).' },
          import: { type: 'string', description: 'Filter by imported module.' },
          calls: { type: 'string', description: 'Filter by call relationships.' },
          uses: { type: 'string', description: 'Filter by identifier usage.' },
          signature: { type: 'string', description: 'Filter by signature text.' },
          param: { type: 'string', description: 'Filter by parameter name.' },
          decorator: { type: 'string', description: 'Filter by decorator/attribute.' },
          inferredType: { type: 'string', description: 'Filter by inferred type.' },
          returnType: { type: 'string', description: 'Filter by return type.' },
          throws: { type: 'string', description: 'Filter by throws/raises.' },
          reads: { type: 'string', description: 'Filter by read dataflow.' },
          writes: { type: 'string', description: 'Filter by write dataflow.' },
          mutates: { type: 'string', description: 'Filter by mutation dataflow.' },
          alias: { type: 'string', description: 'Filter by alias dataflow.' },
          awaits: { type: 'string', description: 'Filter by await targets.' },
          risk: { type: 'string', description: 'Filter by risk tag.' },
          riskTag: { type: 'string', description: 'Filter by risk tag.' },
          riskSource: { type: 'string', description: 'Filter by risk source.' },
          riskSink: { type: 'string', description: 'Filter by risk sink.' },
          riskCategory: { type: 'string', description: 'Filter by risk category.' },
          riskFlow: { type: 'string', description: 'Filter by risk flow.' },
          branchesMin: { type: 'number', description: 'Min branch count.' },
          loopsMin: { type: 'number', description: 'Min loop count.' },
          breaksMin: { type: 'number', description: 'Min break count.' },
          continuesMin: { type: 'number', description: 'Min continue count.' },
          visibility: { type: 'string', description: 'Filter by visibility.' },
          extends: { type: 'string', description: 'Filter by inheritance.' },
          async: { type: 'boolean', description: 'Filter async constructs.' },
          generator: { type: 'boolean', description: 'Filter generator constructs.' },
          returns: { type: 'boolean', description: 'Filter chunks with returns.' },
          churnMin: { type: 'number', description: 'Minimum git churn (added+deleted lines).' },
          chunkAuthor: { type: 'string', description: 'Filter by chunk author (git blame).' },
          modifiedAfter: { type: 'string', description: 'Filter by last modified date (parseable string).' },
          modifiedSince: { type: 'number', description: 'Filter by last modified recency (days).' },
          lint: { type: 'boolean', description: 'Filter chunks with lint results.' },
          path: { type: 'string', description: 'Substring/regex match for file paths.' },
          file: { type: 'string', description: 'Substring/regex match for file paths.' },
          ext: { type: 'string', description: 'Extension filter (ex: .js).' },
          lang: { type: 'string', description: 'Language filter (maps to extensions).' },
          branch: { type: 'string', description: 'Git branch filter (current branch).' },
          case: { type: 'boolean', description: 'Case-sensitive matching for file/path and tokens.' },
          caseFile: { type: 'boolean', description: 'Case-sensitive file/path matching.' },
          caseTokens: { type: 'boolean', description: 'Case-sensitive token matching.' },
          meta: { type: 'object', description: 'Metadata filters for records (key/value).' },
          metaJson: { type: 'string', description: 'JSON metadata filters for records.' }
        },
        required: ['query']
      }
    },
    {
      name: 'search_workspace',
      description: 'Run federated search across repos from a workspace configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          workspacePath: { type: 'string', description: 'Workspace config path (.jsonc).' },
          workspaceId: { type: 'string', description: 'Expected workspace repoSetId (optional cross-check).' },
          query: { type: 'string' },
          search: {
            type: 'object',
            description: 'Single-repo search knobs forwarded per repo (mode/top/backend/filter/etc).'
          },
          select: {
            type: 'object',
            properties: {
              repos: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              tags: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              repoFilter: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              includeDisabled: { type: 'boolean' }
            }
          },
          merge: {
            type: 'object',
            properties: {
              strategy: { type: 'string', enum: ['rrf'] },
              rrfK: { type: 'number' }
            }
          },
          limits: {
            type: 'object',
            properties: {
              perRepoTop: { type: 'number' },
              concurrency: { type: 'number' }
            }
          },
          cohort: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          cohorts: {
            type: 'object',
            properties: {
              policy: { type: 'string', enum: ['default', 'strict'] },
              cohort: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
              allowUnsafeMix: { type: 'boolean' }
            }
          },
          allowUnsafeMix: { type: 'boolean' },
          strict: { type: 'boolean' },
          debug: {
            type: 'object',
            properties: {
              includePaths: { type: 'boolean' }
            }
          }
        },
        required: ['workspacePath', 'query']
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
      name: 'download_dictionaries',
      description: 'Download dictionary wordlists into the shared cache.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          lang: { type: 'string', description: 'Comma-separated language codes (ex: en).' },
          dir: { type: 'string', description: 'Override dictionary directory.' },
          url: { type: 'string', description: 'Extra source(s) name=url (repeatable).' },
          update: { type: 'boolean', description: 'Check for updates (If-Modified-Since).' },
          force: { type: 'boolean', description: 'Force re-downloads.' }
        }
      }
    },
    {
      name: 'download_extensions',
      description: 'Download SQLite ANN extensions into the cache.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          provider: { type: 'string', description: 'Extension provider (ex: sqlite-vec).' },
          dir: { type: 'string', description: 'Override extension directory.' },
          url: { type: 'string', description: 'Override download URL(s) name=url (repeatable).' },
          out: { type: 'string', description: 'Explicit output path.' },
          platform: { type: 'string', description: 'Override platform.' },
          arch: { type: 'string', description: 'Override architecture.' },
          update: { type: 'boolean', description: 'Check for updates (If-Modified-Since).' },
          force: { type: 'boolean', description: 'Force re-downloads.' }
        }
      }
    },
    {
      name: 'verify_extensions',
      description: 'Verify SQLite ANN extension availability.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          provider: { type: 'string' },
          dir: { type: 'string' },
          path: { type: 'string' },
          platform: { type: 'string' },
          arch: { type: 'string' },
          module: { type: 'string' },
          table: { type: 'string' },
          column: { type: 'string' },
          encoding: { type: 'string' },
          options: { type: 'string' },
          annMode: { type: 'string' },
          load: { type: 'boolean', description: 'Attempt to load extension (default true).' }
        }
      }
    },
    {
      name: 'build_sqlite_index',
      description: 'Build SQLite indexes from JSON artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          mode: { type: 'string', enum: ['all', 'code', 'prose'] },
          incremental: { type: 'boolean' },
          compact: { type: 'boolean' },
          codeDir: { type: 'string' },
          proseDir: { type: 'string' },
          out: { type: 'string' }
        }
      }
    },
    {
      name: 'compact_sqlite_index',
      description: 'Compact SQLite indexes to prune unused rows.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          mode: { type: 'string', enum: ['all', 'code', 'prose'] },
          dryRun: { type: 'boolean' },
          keepBackup: { type: 'boolean' }
        }
      }
    },
    {
      name: 'cache_gc',
      description: 'Garbage-collect repo caches.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          dryRun: { type: 'boolean' },
          maxBytes: { type: 'number' },
          maxGb: { type: 'number' },
          maxAgeDays: { type: 'number' }
        }
      }
    },
    {
      name: 'clean_artifacts',
      description: 'Remove repo cache artifacts (optional all repos).',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          all: { type: 'boolean' },
          dryRun: { type: 'boolean' }
        }
      }
    },
    {
      name: 'bootstrap',
      description: 'Bootstrap models/dictionaries and build indexes.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          skipInstall: { type: 'boolean' },
          skipDicts: { type: 'boolean' },
          skipIndex: { type: 'boolean' },
          skipArtifacts: { type: 'boolean' },
          skipTooling: { type: 'boolean' },
          withSqlite: { type: 'boolean' },
          incremental: { type: 'boolean' }
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

export function getToolCatalog(defaultModelId) {
  return {
    schemaVersion: MCP_SCHEMA_VERSION,
    toolVersion: getToolVersion(),
    tools: getToolDefs(defaultModelId)
  };
}
