import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { DEFAULT_MODEL_ID } from '../../shared/dict-utils.js';
import { buildSearchRequestArgs } from '../../../src/shared/search-request.js';
import { compileSchema, createAjv } from '../../../src/shared/validation/ajv-factory.js';

const SEARCH_DEF = getToolDefs(DEFAULT_MODEL_ID).find((tool) => tool.name === 'search');
if (!SEARCH_DEF) {
  throw new Error('MCP search tool definition not found.');
}

const SCHEMA_FIELDS = new Set(Object.keys(SEARCH_DEF.inputSchema?.properties || {}));
const validateSearchArgs = compileSchema(
  createAjv({ strict: false, allErrors: false, coerceTypes: false }),
  SEARCH_DEF.inputSchema,
  { lazy: true }
);
const RESERVED_FIELDS = new Set([]);
const HANDLED_FIELDS = new Set([
  'repoPath',
  'query',
  'cursor',
  'asOf',
  'snapshot',
  'snapshotId',
  'mode',
  'backend',
  'output',
  'ann',
  'allowSparseFallback',
  'allowUnsafeMix',
  'top',
  'context',
  'type',
  'author',
  'import',
  'calls',
  'uses',
  'signature',
  'param',
  'decorator',
  'inferredType',
  'returnType',
  'throws',
  'reads',
  'writes',
  'mutates',
  'alias',
  'awaits',
  'risk',
  'riskTag',
  'riskSource',
  'riskSink',
  'riskCategory',
  'riskFlow',
  'branchesMin',
  'loopsMin',
  'breaksMin',
  'continuesMin',
  'visibility',
  'extends',
  'async',
  'generator',
  'returns',
  'churnMin',
  'chunkAuthor',
  'modifiedAfter',
  'modifiedSince',
  'lint',
  'path',
  'paths',
  'filter',
  'file',
  'ext',
  'lang',
  'branch',
  'case',
  'caseFile',
  'caseTokens',
  'meta',
  'metaJson'
]);

const missing = [...SCHEMA_FIELDS].filter(
  (field) => !HANDLED_FIELDS.has(field) && !RESERVED_FIELDS.has(field)
);
if (missing.length) {
  throw new Error(`MCP search schema fields missing mapping: ${missing.join(', ')}`);
}

export const getMcpSearchSchemaFields = () => [...SCHEMA_FIELDS];
export const getMcpSearchReservedFields = () => [...RESERVED_FIELDS];

/** Admit the advertised value domain before resolving repository authority or caches. */
export function buildMcpSearchRequest(args = {}, { resolveRepoPath = value => value } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw createError(ERROR_CODES.INVALID_REQUEST, 'MCP search args must be an object.');
  }
  const unknown = Object.keys(args).filter((key) => !SCHEMA_FIELDS.has(key));
  if (unknown.length) {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Unknown MCP search args: ${unknown.join(', ')}`);
  }
  for (const key of RESERVED_FIELDS) {
    if (args[key] !== undefined && args[key] !== null) {
      throw createError(ERROR_CODES.INVALID_REQUEST, `Reserved MCP search arg set: ${key}`);
    }
  }

  if (!validateSearchArgs(args)) {
    const detail = (validateSearchArgs.errors || []).map(error => (
      `${error.instancePath || '#'} ${error.message}`
    )).join('; ');
    throw createError(ERROR_CODES.INVALID_REQUEST, `Invalid MCP search args: ${detail}`);
  }

  const repoPath = resolveRepoPath(args.repoPath);

  const result = buildSearchRequestArgs(args, {
    defaultOutput: 'compact',
    allowedOutputs: ['compact', 'full'],
    includeRepo: true,
    repoPath,
    topFlag: '-n',
    topMin: 0,
    omitModeBoth: true
  });

  if (!result.ok) {
    throw createError(ERROR_CODES.INVALID_REQUEST, result.message || 'Invalid MCP search args.');
  }

  return { args: result.args, repoPath };
}

export const buildMcpSearchArgs = (args = {}) => buildMcpSearchRequest(args).args;
