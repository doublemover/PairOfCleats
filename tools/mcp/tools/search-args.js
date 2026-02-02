import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { createError, ERROR_CODES } from '../../../src/shared/error-codes.js';
import { DEFAULT_MODEL_ID } from '../../dict-utils.js';
import { normalizeMetaFilters } from './helpers.js';

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

const toList = (value) => (Array.isArray(value) ? value : (value == null ? [] : [value]));
const normalizeOutput = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

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

  const searchArgs = ['--json'];
  const repoPath = args.repoPath ? String(args.repoPath) : '';
  if (repoPath) searchArgs.push('--repo', repoPath);

  const output = normalizeOutput(args.output);
  if (output && output !== 'compact' && output !== 'full') {
    throw createError(ERROR_CODES.INVALID_REQUEST, `Unsupported MCP output mode: ${output}`);
  }
  if (output !== 'full') searchArgs.push('--compact');

  const mode = args.mode ? String(args.mode) : null;
  const backend = args.backend ? String(args.backend) : null;
  const ann = typeof args.ann === 'boolean' ? args.ann : null;
  const top = Number.isFinite(Number(args.top)) ? Math.max(1, Number(args.top)) : null;
  const contextLines = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;
  const typeFilter = args.type ? String(args.type) : null;
  const authorFilter = args.author ? String(args.author) : null;
  const importFilter = args.import ? String(args.import) : null;
  const callsFilter = args.calls ? String(args.calls) : null;
  const usesFilter = args.uses ? String(args.uses) : null;
  const signatureFilter = args.signature ? String(args.signature) : null;
  const paramFilter = args.param ? String(args.param) : null;
  const decoratorFilter = args.decorator ? String(args.decorator) : null;
  const inferredTypeFilter = args.inferredType ? String(args.inferredType) : null;
  const returnTypeFilter = args.returnType ? String(args.returnType) : null;
  const throwsFilter = args.throws ? String(args.throws) : null;
  const readsFilter = args.reads ? String(args.reads) : null;
  const writesFilter = args.writes ? String(args.writes) : null;
  const mutatesFilter = args.mutates ? String(args.mutates) : null;
  const aliasFilter = args.alias ? String(args.alias) : null;
  const awaitsFilter = args.awaits ? String(args.awaits) : null;
  const riskFilter = args.risk ? String(args.risk) : null;
  const riskTagFilter = args.riskTag ? String(args.riskTag) : null;
  const riskSourceFilter = args.riskSource ? String(args.riskSource) : null;
  const riskSinkFilter = args.riskSink ? String(args.riskSink) : null;
  const riskCategoryFilter = args.riskCategory ? String(args.riskCategory) : null;
  const riskFlowFilter = args.riskFlow ? String(args.riskFlow) : null;
  const branchesMin = Number.isFinite(Number(args.branchesMin)) ? Number(args.branchesMin) : null;
  const loopsMin = Number.isFinite(Number(args.loopsMin)) ? Number(args.loopsMin) : null;
  const breaksMin = Number.isFinite(Number(args.breaksMin)) ? Number(args.breaksMin) : null;
  const continuesMin = Number.isFinite(Number(args.continuesMin)) ? Number(args.continuesMin) : null;
  const churnMin = Number.isFinite(Number(args.churnMin)) ? Number(args.churnMin) : null;
  const chunkAuthorFilter = args.chunkAuthor ? String(args.chunkAuthor) : null;
  const modifiedAfter = args.modifiedAfter ? String(args.modifiedAfter) : null;
  const modifiedSince = Number.isFinite(Number(args.modifiedSince)) ? Number(args.modifiedSince) : null;
  const visibilityFilter = args.visibility ? String(args.visibility) : null;
  const extendsFilter = args.extends ? String(args.extends) : null;
  const lintFilter = args.lint === true;
  const asyncFilter = args.async === true;
  const generatorFilter = args.generator === true;
  const returnsFilter = args.returns === true;
  const branchFilter = args.branch ? String(args.branch) : null;
  const langFilter = args.lang ? String(args.lang) : null;
  const caseAll = args.case === true;
  const caseFile = args.caseFile === true || caseAll;
  const caseTokens = args.caseTokens === true || caseAll;
  const pathFilters = toList(args.path);
  const fileFilters = toList(args.file);
  const extFilters = toList(args.ext);
  const metaFilters = normalizeMetaFilters(args.meta);
  const metaJson = args.metaJson || null;

  if (mode && mode !== 'both') searchArgs.push('--mode', mode);
  if (backend) searchArgs.push('--backend', backend);
  if (ann === true) searchArgs.push('--ann');
  if (ann === false) searchArgs.push('--no-ann');
  if (top) searchArgs.push('-n', String(top));
  if (contextLines !== null) searchArgs.push('--context', String(contextLines));
  if (typeFilter) searchArgs.push('--type', typeFilter);
  if (authorFilter) searchArgs.push('--author', authorFilter);
  if (importFilter) searchArgs.push('--import', importFilter);
  if (callsFilter) searchArgs.push('--calls', callsFilter);
  if (usesFilter) searchArgs.push('--uses', usesFilter);
  if (signatureFilter) searchArgs.push('--signature', signatureFilter);
  if (paramFilter) searchArgs.push('--param', paramFilter);
  if (decoratorFilter) searchArgs.push('--decorator', decoratorFilter);
  if (inferredTypeFilter) searchArgs.push('--inferred-type', inferredTypeFilter);
  if (returnTypeFilter) searchArgs.push('--return-type', returnTypeFilter);
  if (throwsFilter) searchArgs.push('--throws', throwsFilter);
  if (readsFilter) searchArgs.push('--reads', readsFilter);
  if (writesFilter) searchArgs.push('--writes', writesFilter);
  if (mutatesFilter) searchArgs.push('--mutates', mutatesFilter);
  if (aliasFilter) searchArgs.push('--alias', aliasFilter);
  if (awaitsFilter) searchArgs.push('--awaits', awaitsFilter);
  if (riskFilter) searchArgs.push('--risk', riskFilter);
  if (riskTagFilter) searchArgs.push('--risk-tag', riskTagFilter);
  if (riskSourceFilter) searchArgs.push('--risk-source', riskSourceFilter);
  if (riskSinkFilter) searchArgs.push('--risk-sink', riskSinkFilter);
  if (riskCategoryFilter) searchArgs.push('--risk-category', riskCategoryFilter);
  if (riskFlowFilter) searchArgs.push('--risk-flow', riskFlowFilter);
  if (branchesMin !== null) searchArgs.push('--branches', String(branchesMin));
  if (loopsMin !== null) searchArgs.push('--loops', String(loopsMin));
  if (breaksMin !== null) searchArgs.push('--breaks', String(breaksMin));
  if (continuesMin !== null) searchArgs.push('--continues', String(continuesMin));
  if (churnMin !== null) searchArgs.push('--churn', String(churnMin));
  if (chunkAuthorFilter) searchArgs.push('--chunk-author', chunkAuthorFilter);
  if (modifiedAfter) searchArgs.push('--modified-after', modifiedAfter);
  if (modifiedSince !== null) searchArgs.push('--modified-since', String(modifiedSince));
  if (visibilityFilter) searchArgs.push('--visibility', visibilityFilter);
  if (extendsFilter) searchArgs.push('--extends', extendsFilter);
  if (lintFilter) searchArgs.push('--lint');
  if (asyncFilter) searchArgs.push('--async');
  if (generatorFilter) searchArgs.push('--generator');
  if (returnsFilter) searchArgs.push('--returns');
  if (branchFilter) searchArgs.push('--branch', branchFilter);
  if (langFilter) searchArgs.push('--lang', langFilter);
  if (caseAll) searchArgs.push('--case');
  if (!caseAll && caseFile) searchArgs.push('--case-file');
  if (!caseAll && caseTokens) searchArgs.push('--case-tokens');
  for (const entry of pathFilters) {
    if (entry == null || entry === '') continue;
    searchArgs.push('--path', String(entry));
  }
  for (const entry of fileFilters) {
    if (entry == null || entry === '') continue;
    searchArgs.push('--file', String(entry));
  }
  for (const entry of extFilters) {
    if (entry == null || entry === '') continue;
    searchArgs.push('--ext', String(entry));
  }
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((entry) => searchArgs.push('--meta', entry));
  }
  if (metaJson) {
    const jsonValue = typeof metaJson === 'string' ? metaJson : JSON.stringify(metaJson);
    searchArgs.push('--meta-json', jsonValue);
  }

  return searchArgs;
}
