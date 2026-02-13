import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { DEFAULT_MODEL_ID } from '../../shared/dict-utils.js';
import { buildSearchRequestArgs } from '../../shared/search-request.js';

const SEARCH_DEF = getToolDefs(DEFAULT_MODEL_ID).find((tool) => tool.name === 'search');
if (!SEARCH_DEF) {
  throw new Error('MCP search tool definition not found.');
}

const SCHEMA_FIELDS = new Set(Object.keys(SEARCH_DEF.inputSchema?.properties || {}));
const RESERVED_FIELDS = new Set([]);
const HANDLED_FIELDS = new Set([
  'repoPath',
  'query',
  'mode',
  'backend',
  'output',
  'ann',
  'allowSparseFallback',
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

export function buildMcpSearchArgs(args = {}) {
  if (!args || typeof args !== 'object') return ['--json', '--compact'];
  const unknown = Object.keys(args).filter((key) => !SCHEMA_FIELDS.has(key));
  if (unknown.length) {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Unknown MCP search args: ${unknown.join(', ')}`);
  }
  for (const key of RESERVED_FIELDS) {
    if (args[key] !== undefined && args[key] !== null) {
      throw createError(ERROR_CODES.INVALID_REQUEST, `Reserved MCP search arg set: ${key}`);
    }
  }

  const result = buildSearchRequestArgs(args, {
    defaultOutput: 'compact',
    allowedOutputs: ['compact', 'full'],
    includeRepo: true,
    repoPath: args.repoPath,
    topFlag: '-n',
    topMin: 1,
    omitModeBoth: true
  });

  if (!result.ok) {
    throw createError(ERROR_CODES.INVALID_REQUEST, result.message || 'Invalid MCP search args.');
  }

  return result.args;
}
