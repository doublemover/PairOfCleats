import { CONTEXT_TASK_POLICY_SCHEMA } from '../../contracts/schemas/context-task.js';
import { CONTEXT_RENDERED_TOKEN_BUDGET_SCHEMA } from '../../contracts/schemas/context-token-budget.js';
import { buildSearchRequestProperties } from '../../shared/search-request-schema.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-trace.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-find.js';
import { SEMANTIC_EXPLAIN_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-explain.js';
import { SEMANTIC_ENRICHMENT_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-enrichment.js';
import { RUNTIME_LOOKUP_SERVICE_REQUEST_SCHEMA, RUNTIME_DISCOVERY_SERVICE_REQUEST_SCHEMA } from '../../contracts/schemas/runtime-query.js';
import { RUNTIME_COMPARE_SERVICE_SCHEMA, RUNTIME_CLAIMS_SERVICE_SCHEMA } from '../../contracts/schemas/runtime-claims.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA } from '../../contracts/schemas/semantic-query.js';
import { GRAPH_EVIDENCE_REQUEST_SCHEMA } from '../../contracts/schemas/graph-evidence.js';
import { getToolVersion } from '../../../tools/dict-utils/tool.js';
import { SEARCH_REQUEST_REQUIREMENT } from '../../shared/search-request.js';

export const MCP_SCHEMA_VERSION = '1.10.1';

const STRING_OR_STRING_ARRAY_SCHEMA = Object.freeze({
  anyOf: [
    { type: 'string' },
    { type: 'array', items: { type: 'string' } }
  ]
});

const MCP_RISK_FILTER_SCHEMA_PROPERTIES = Object.freeze({
  rule: STRING_OR_STRING_ARRAY_SCHEMA,
  category: STRING_OR_STRING_ARRAY_SCHEMA,
  severity: STRING_OR_STRING_ARRAY_SCHEMA,
  tag: STRING_OR_STRING_ARRAY_SCHEMA,
  source: STRING_OR_STRING_ARRAY_SCHEMA,
  sink: STRING_OR_STRING_ARRAY_SCHEMA,
  flowId: STRING_OR_STRING_ARRAY_SCHEMA,
  flow_id: STRING_OR_STRING_ARRAY_SCHEMA,
  'flow-id': STRING_OR_STRING_ARRAY_SCHEMA,
  sourceRule: STRING_OR_STRING_ARRAY_SCHEMA,
  source_rule: STRING_OR_STRING_ARRAY_SCHEMA,
  'source-rule': STRING_OR_STRING_ARRAY_SCHEMA,
  sinkRule: STRING_OR_STRING_ARRAY_SCHEMA,
  sink_rule: STRING_OR_STRING_ARRAY_SCHEMA,
  'sink-rule': STRING_OR_STRING_ARRAY_SCHEMA
});

const MCP_WORKSPACE_SELECT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    repos: STRING_OR_STRING_ARRAY_SCHEMA,
    tags: STRING_OR_STRING_ARRAY_SCHEMA,
    repoFilter: STRING_OR_STRING_ARRAY_SCHEMA,
    includeDisabled: { type: 'boolean' }
  })
});

const buildWorkspaceToolProperties = ({
  workspacePathDescription = 'Workspace config path (.jsonc).',
  extraProperties = {}
} = {}) => ({
  workspacePath: { type: 'string', description: workspacePathDescription },
  workspaceId: { type: 'string', description: 'Expected workspace repoSetId (optional cross-check).' },
  select: MCP_WORKSPACE_SELECT_SCHEMA,
  ...extraProperties
});

/**
 * Build MCP tool definitions for the server.
 * @param {string} defaultModelId
 * @returns {Array<object>}
 */
export function getToolDefs(defaultModelId) {
  return [
    { name: 'graph_evidence', description: 'Experimental, qualification pending: page retained call occurrences or resolved adjacency in an explicit immutable build. Bounded retained-family coverage does not establish upstream semantic completeness.', inputSchema: { type: 'object', ...GRAPH_EVIDENCE_REQUEST_SCHEMA } },
    {name:'semantic_find',description:'Experimental, qualification pending: discover pinned structural/compiler-target candidates, exact type-expression facts by source and role, or parser-established scalar literal occurrences. Bounded indexed coverage; no assignability, alias expansion, behavioral equivalence or universal runtime-value claim.',inputSchema:SEMANTIC_FIND_REQUEST_SCHEMA},
    {name:'semantic_explain',description:'Experimental, qualification pending: explain a pinned static witness and suggest exact source/task plan or enqueue requests. Never executes suggested work automatically.',inputSchema:SEMANTIC_EXPLAIN_REQUEST_SCHEMA},
    {name:'semantic_enrichment',description:'Experimental, qualification pending: plan by default; explicit enqueue persists pending tasks, explicit drain requires verified dependency authority and whole-generation publication. No live retrieval overlays.',inputSchema:SEMANTIC_ENRICHMENT_REQUEST_SCHEMA},
    { name: 'runtime_evidence', description: 'Query explicitly pinned saved runtime families with exact capture/source/workload/code-lifetime selectors. Never executes, probes or attaches.', inputSchema: RUNTIME_LOOKUP_SERVICE_REQUEST_SCHEMA },
    { name: 'runtime_families', description: 'Discover retained immutable saved runtime families within an authorized repository destination. Bounded paging; never captures or executes.', inputSchema: RUNTIME_DISCOVERY_SERVICE_REQUEST_SCHEMA },
    { name: 'runtime_compare', description: 'Compare two compatible saved captures descriptively, optionally retaining immutable derived claims and observation citations. Never collects or executes.', inputSchema: RUNTIME_COMPARE_SERVICE_SCHEMA },
    { name: 'runtime_claims', description: 'Retrieve a pinned immutable derived claim family and verify its retained direct observations and raw support.', inputSchema: RUNTIME_CLAIMS_SERVICE_SCHEMA },
    { name: 'semantic_trace', description: 'Trace source-pinned value relationships with evidence, boundary requests and explicit incomplete frontiers. Does not execute runtime capture.', inputSchema: SEMANTIC_TRACE_REQUEST_SCHEMA },
    {
      name: 'semantic_detail',
      description: 'Inspect exact semantic records and finite-string type membership or zero/one/many witnesses in an explicit immutable generation. Record detail supports bounded paging; other analysis coverage may remain unsupported.',
      inputSchema: SEMANTIC_DETAIL_REQUEST_SCHEMA
    },
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
      description: 'Run ranked text search or exhaustively enumerate indexed filter matches with generation-bound continuation.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: buildSearchRequestProperties({ outputs: ['compact', 'full'], descriptions: {
          repoPath: 'Repo path (defaults to server cwd).',
          cursor: 'Filter-only nextCursor; reuse identical filters, modes and generation.',
          asOf: 'Pin the original indexed build or snapshot.',
          snapshot: 'Compatibility snapshot reference; cannot combine with asOf.',
          snapshotId: 'Alias for snapshot; conflicting references fail.',
          output: 'Return compact JSON (default) or full payload.',
          ann: 'Enable ANN re-ranking (default uses config).',
          allowSparseFallback: 'Allow ANN fallback when sparse-only is requested but sparse is unavailable.',
          allowUnsafeMix: 'Allow compatibility/profile cohort mixing when keys do not match.',
          top: 'Top N results.',
          context: 'Deprecated zero-only compatibility input. Use context_pack for source context.',
          type: 'Filter by chunk kind/type.',
          author: 'Filter by last author (git).',
          import: 'Filter by imported module.',
          calls: 'Filter by call relationships.',
          uses: 'Filter by identifier usage.',
          signature: 'Filter by signature text.',
          param: 'Filter by parameter name.',
          decorator: 'Filter by decorator/attribute.',
          inferredType: 'Filter by inferred type.',
          returnType: 'Filter by return type.',
          throws: 'Filter by throws/raises.',
          reads: 'Filter by read dataflow.',
          writes: 'Filter by write dataflow.',
          mutates: 'Filter by mutation dataflow.',
          alias: 'Filter by alias dataflow.',
          awaits: 'Filter by await targets.',
          risk: 'Filter by risk tag.',
          riskTag: 'Filter by risk tag.',
          riskSource: 'Filter by risk source.',
          riskSink: 'Filter by risk sink.',
          riskCategory: 'Filter by risk category.',
          riskFlow: 'Filter by risk flow.',
          branchesMin: 'Min branch count.',
          loopsMin: 'Min loop count.',
          breaksMin: 'Min break count.',
          continuesMin: 'Min continue count.',
          visibility: 'Filter by visibility.',
          extends: 'Filter by inheritance.',
          async: 'Filter async constructs.',
          generator: 'Filter generator constructs.',
          returns: 'Filter chunks with returns.',
          churnMin: 'Minimum git churn (added+deleted lines).',
          chunkAuthor: 'Filter by chunk author (git blame).',
          modifiedAfter: 'Filter by last modified date (parseable string).',
          modifiedSince: 'Filter by last modified recency (days).',
          lint: 'Filter chunks with lint results.',
          path: 'Substring/regex match for file paths.',
          filter: 'Canonical filter expression.',
          file: 'Substring/regex match for file paths.',
          ext: 'Extension filter (ex: .js).',
          lang: 'Language filter (maps to extensions).',
          branch: 'Git branch filter (current branch).',
          case: 'Case-sensitive matching for file/path and tokens.',
          caseFile: 'Case-sensitive file/path matching.',
          caseTokens: 'Case-sensitive token matching.',
          meta: 'Metadata filters for records (key/value).',
          metaJson: 'JSON metadata filters for records.',
        } }),
        ...SEARCH_REQUEST_REQUIREMENT
      }
    },
    {
      name: 'context_pack',
      description: 'Generate a composite context pack for a seed in the current code index.',
      inputSchema: {
        type: 'object',
        properties: buildWorkspaceToolProperties({
          workspacePathDescription: 'Workspace config path (.jsonc) for federated risk packs.',
          extraProperties: {
            repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
            includeDisabled: { type: 'boolean' },
            maxFederatedRepos: { type: 'number' },
            seed: { type: 'string', description: 'Chunk/file/symbol seed reference.' },
            taskPolicy: CONTEXT_TASK_POLICY_SCHEMA,
            renderedTokenBudget: CONTEXT_RENDERED_TOKEN_BUDGET_SCHEMA,
            pathSemantics: { enum: ['graph-witness'] },
            hops: { type: 'number', description: 'Neighborhood depth.' },
            includeGraph: { type: 'boolean' },
            includeSemantic: { type: 'boolean' },
            includeTypes: { type: 'boolean' },
            includeRisk: { type: 'boolean' },
            includeRiskPartialFlows: { type: 'boolean' },
            strictRisk: { type: 'boolean' },
            strictEvidence: { type: 'boolean' },
            includeImports: { type: 'boolean' },
            includeUsages: { type: 'boolean' },
            includeCallersCallees: { type: 'boolean' },
            includePaths: { type: 'boolean' },
            maxBytes: { type: 'number' },
            maxTokens: { type: 'number' },
            maxTypeEntries: { type: 'number' },
            maxDepth: { type: 'number' },
            maxFanoutPerNode: { type: 'number' },
            maxNodes: { type: 'number' },
            maxEdges: { type: 'number' },
            maxPaths: { type: 'number' },
            maxCandidates: { type: 'number' },
            maxWorkUnits: { type: 'number' },
            maxWallClockMs: { type: 'number' },
            filters: {
              type: 'object',
              properties: MCP_RISK_FILTER_SCHEMA_PROPERTIES
            }
          }
        }),
        required: ['seed', 'hops']
      }
    },
    {
      name: 'risk_explain',
      description: 'Explain interprocedural risk flows for a chunk in the current code index.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          chunk: { type: 'string', description: 'Chunk UID to explain.' },
          max: { type: 'number', description: 'Maximum number of flows to return.' },
          includePartialFlows: { type: 'boolean', description: 'Include partial frontier flows when full flows are capped or incomplete.' },
          maxPartialFlows: { type: 'number', description: 'Maximum number of partial flows to return.' },
          filters: {
            type: 'object',
            properties: MCP_RISK_FILTER_SCHEMA_PROPERTIES
          }
        },
        required: ['chunk']
      }
    },
    {
      name: 'risk_delta',
      description: 'Compare risk flows for one seed across two code-index refs.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          seed: { type: 'string', description: 'Chunk/file/symbol seed reference.' },
          from: { type: 'string', description: 'From ref (build:<id>, snap:<id>, tag:<name>, latest).' },
          to: { type: 'string', description: 'To ref (build:<id>, snap:<id>, tag:<name>, latest).' },
          includePartialFlows: { type: 'boolean', description: 'Compare partial frontier flows in addition to full flows.' },
          filters: {
            type: 'object',
            properties: MCP_RISK_FILTER_SCHEMA_PROPERTIES
          }
        },
        required: ['seed', 'from', 'to']
      }
    },
    {
      name: 'search_workspace',
      description: 'Run federated search across repos from a workspace configuration.',
      inputSchema: {
        type: 'object',
        properties: buildWorkspaceToolProperties({
          extraProperties: {
            query: { type: 'string' },
            search: {
              type: 'object',
              description: 'Single-repo search knobs forwarded per repo (mode/top/backend/filter/etc).'
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
          }
        }),
        required: ['workspacePath']
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
          strict: { type: 'boolean', description: 'Fail when malformed JSONL records are encountered.' },
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
      description: 'Download the user-approved SQLite ANN artifact into managed storage.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          update: { type: 'boolean', description: 'Check for updates (If-Modified-Since).' },
          force: { type: 'boolean', description: 'Force re-downloads.' }
        }
      }
    },
    {
      name: 'verify_extensions',
      description: 'Verify the user-approved SQLite ANN artifact; non-loading by default.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
          module: { type: 'string' },
          table: { type: 'string' },
          column: { type: 'string' },
          encoding: { type: 'string' },
          options: { type: 'string' },
          annMode: { type: 'string' },
          load: { type: 'boolean', description: 'Explicitly load the user-approved artifact (default false; requires server launch authorization).' }
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
      description: 'Preview cleanup of only the selected repository cache using quota or age limits. Explicit dryRun=false applies deletion; process-lifetime leases protect cooperating sessions. Shared CAS and other repositories require user-owned maintenance CLI scope.',
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
      description: 'Remove only the selected repo cache artifacts from approved owned storage.',
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Repo path (defaults to server cwd).' },
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
