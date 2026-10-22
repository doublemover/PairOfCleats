import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { qualifySqlSelectRanges } from './sql-source-qualifier.js';

const require = createRequire(import.meta.url);
const fail = message => Object.assign(new Error(message), { code: 'ERR_SQL_CATALOG_EVIDENCE' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const boundedName = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/u.test(value);
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);
const safePath = value => typeof value === 'string' && value && !/[\\:\x00-\x1f]/u.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

export const SQL_CATALOG_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'sql-offline-catalog', adapterVersion: '1', execution: 'trusted-inprocess', languages: [{ id: 'sql', dialect: 'postgresql' }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 1024 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Explicit local catalog + a conservative PostgreSQL SELECT subset. Nothing
 * connects to a database, discovers credentials, runs migrations or evaluates
 * procedural SQL. Unmodeled scopes/overloads remain partial and unresolved. */
export const collectOfflineSqlCatalogEvidence = ({ catalog, expectedCatalogIdentity, expectedContext, generation,
  documents, queryPaths, configHash, dependencyHash, profileHash = null, maxSourceBytes = 500 * 1024,
  maxCatalogBytes = 256 * 1024, maxNodes = 32768, maxReferences = 4096, maxMs = 1000, signal = null }) => {
  if (!(documents instanceof Map) || !documents.size || documents.size > 20 || !Array.isArray(queryPaths) || !queryPaths.length
    || queryPaths.length > 20 || new Set(queryPaths).size !== queryPaths.length
    || !digest(expectedCatalogIdentity) || !digest(configHash) || !digest(dependencyHash) || (profileHash !== null && !digest(profileHash))
    || !generation || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxCatalogBytes) || maxCatalogBytes < 1 || maxCatalogBytes > 256 * 1024
    || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 32768
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid bounded SQL catalog inputs.');
  const started = performance.now();
  const check = () => { throwIfAborted(signal); if (performance.now() - started >= maxMs) throw fail('SQL catalog time budget exhausted.'); };
  check();
  const encoded = canonicalSemanticJson(catalog);
  if (Buffer.byteLength(encoded) > maxCatalogBytes) throw fail('Offline SQL catalog byte budget exhausted.');
  catalog = JSON.parse(encoded);
  const { identity, ...identityInput } = catalog;
  if (catalog.schemaVersion !== 1 || identity !== expectedCatalogIdentity || semanticHash('tooling.sql-offline-catalog.v1', identityInput) !== identity
    || !same(catalog.generation, generation) || !same(catalog.context, expectedContext)
    || catalog.context?.dialect !== 'postgresql' || !boundedName(catalog.context.serverVersion)
    || !Array.isArray(catalog.context.searchPath) || !catalog.context.searchPath.length || catalog.context.searchPath.length > 32
    || catalog.context.searchPath.some(value => !boundedName(value) || value === '$user' || value.startsWith('pg_temp'))
    || new Set(catalog.context.searchPath).size !== catalog.context.searchPath.length
    || !Array.isArray(catalog.context.extensions) || catalog.context.extensions.length > 128
    || catalog.context.extensions.some(value => !boundedName(value.name) || !boundedName(value.version))
    || !digest(catalog.context.migrationIdentity) || !Array.isArray(catalog.tables) || catalog.tables.length > 1024) throw fail('Offline SQL dialect/server/search_path/extension/migration/generation identity mismatch.');
  const version = require('node-sql-parser/package.json').version;
  if (version !== '5.4.0') throw fail('SQL parser version is not qualified by this adapter profile.');
  const { Parser } = require('node-sql-parser'), parser = new Parser(), results = new Map();
  let sourceBytes = 0, nodeCount = 0, referenceCount = 0, columnCount = 0, candidateCount = 0, retainedReferenceBytes = 0, namespace = null;
  for (const [filename, item] of documents) {
    check();
    if (!safePath(filename) || item?.source?.path !== filename || typeof item.text !== 'string'
      || createHash('sha256').update(item.text).digest('hex') !== item.source.byteHash
      || (namespace !== null && namespace !== item.source.repositoryNamespace)) throw fail('SQL source differs from its immutable source snapshot.');
    namespace = item.source.repositoryNamespace;
    if (item.facts && !same(item.facts.storage.generation, generation)) throw fail('SQL source belongs to another generation.');
    if (item.source.mapping && item.source.mapping.quality !== 'exact') throw fail('SQL source mapping is not exact.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('SQL source byte budget exhausted.');
    results.set(filename, { path: filename, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      state: 'partial', reason: 'source_dependency_only', references: [], diagnostics: [] });
  }
  const validSpan = (span, item) => Array.isArray(span) && span.length === 2 && span.every(value => Number.isSafeInteger(value)
    && value >= 0 && value <= item.text.length) && span[0] <= span[1] && span.every(offset => !(offset > 0 && offset < item.text.length
      && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])));
  const witness = value => {
    const item = documents.get(value?.path);
    if (!item || item.source.sourceUnitId !== value.sourceUnitId || item.source.byteHash !== value.sourceHash || !validSpan(value.span, item)) throw fail('Catalog migration witness is stale or outside its source closure.');
    return structuredClone(value);
  };
  const tables = new Map();
  for (const table of catalog.tables) {
    check();
    if (!boundedName(table.schema) || !boundedName(table.name) || !Array.isArray(table.columns) || table.columns.length > 4096
      || typeof table.temporary !== 'boolean') throw fail('Invalid bounded catalog table.');
    const key = canonicalSemanticJson([table.schema, table.name]);
    if (tables.has(key)) throw fail('Duplicate offline SQL table identity.');
    const entry = { ...table, source: witness(table.source), columns: new Map() };
    for (const column of table.columns) {
      if (++columnCount > 4096 || !boundedName(column.name) || entry.columns.has(column.name)) throw fail('Invalid, duplicate or oversized SQL column inventory.');
      entry.columns.set(column.name, { ...column, source: witness(column.source) });
    }
    tables.set(key, entry);
  }
  const fromLocation = (node, item) => {
    const span = [node?.loc?.start?.offset, node?.loc?.end?.offset];
    return validSpan(span, item) ? span : null;
  };
  const chooseTable = parts => {
    if (parts.length > 2) return { table: null, reason: 'cross_database_name_unsupported' };
    const schemas = parts.length === 2 ? [parts[0]] : catalog.context.searchPath, name = parts.at(-1);
    for (const schema of schemas) {
      const table = tables.get(canonicalSemanticJson([schema, name]));
      if (table) return table.temporary ? { table: null, reason: 'temporary_object_context_unknown' } : { table, reason: null };
    }
    return { table: null, reason: 'catalog_table_unavailable' };
  };
  const append = (result, family, name, span, target, reason, candidates = [], catalogObject = null) => {
    if (++referenceCount > maxReferences) throw fail('SQL reference budget exhausted.');
    candidateCount += candidates.length;
    if (candidateCount > maxReferences) throw fail('SQL ambiguity candidate budget exhausted.');
    const reference = { family, name, span, target, state: target ? 'resolved' : 'unresolved', reason: target ? null : reason, candidates, catalogObject };
    retainedReferenceBytes += Buffer.byteLength(canonicalSemanticJson(reference));
    if (retainedReferenceBytes > 512 * 1024) throw fail('SQL retained reference byte budget exhausted.');
    result.references.push(reference);
  };
  for (const filename of queryPaths) {
    check();
    const item = documents.get(filename), result = results.get(filename);
    if (!item) throw fail('SQL query source was not explicitly admitted.');
    result.reason = 'offline_catalog_observation_only';
    let statements;
    if (item.text.length > 32768) throw fail('SQL query exceeds the fixed source qualifier limit.');
    try { const ast = parser.astify(item.text, { database: 'Postgresql', parseOptions: { includeLocations: true } }); statements = Array.isArray(ast) ? ast : [ast]; }
    catch (error) { result.reason = 'syntax_or_dialect_unsupported'; result.diagnostics.push({ code: 'syntax_or_dialect_unsupported', message: String(error.message || error).slice(0, 2048), span: null }); continue; }
    check();
    let qualifiers;
    try { qualifiers = qualifySqlSelectRanges(item.text, { check, maxTokens: Math.min(maxNodes, 16384) }); }
    catch (cause) { throw Object.assign(fail('SQL source range qualification failed.'), { cause }); }
    if (qualifiers.length !== statements.length) {
      result.diagnostics.push({ code: 'statement_source_ranges_unavailable', span: null }); continue;
    }
    for (const [statementIndex, statement] of statements.entries()) {
      const qualifier = qualifiers[statementIndex];
      const entries = [], pending = [{ node: statement, depth: 0 }], seen = new Set();
      let unsupportedScope = statement?.type !== 'select' || Boolean(statement?.with) || !Array.isArray(statement?.from);
      while (pending.length) {
        check();
        const { node, depth } = pending.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (++nodeCount > maxNodes || depth > 128) throw fail('SQL AST node/depth budget exhausted.');
        if (node !== statement && node.type === 'select') unsupportedScope = true;
        entries.push(node);
        for (const [key, value] of Object.entries(node)) {
          if (key === 'loc') continue;
          if (Array.isArray(value)) for (const child of value) if (child && typeof child === 'object') pending.push({ node: child, depth: depth + 1 });
          if (value && typeof value === 'object' && !Array.isArray(value)) pending.push({ node: value, depth: depth + 1 });
        }
      }
      if (unsupportedScope || !qualifier.supported || qualifier.tables.length !== statement.from.length
        || statement.from.some(from => typeof from.table !== 'string' || from.expr)) {
        if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'query_scope_unsupported', span: fromLocation(statement, item) }); continue;
      }
      const bindings = [], aliases = new Map();
      let scopeComplete = true;
      for (const [fromIndex, from] of statement.from.entries()) {
        const parsed = qualifier.tables[fromIndex], span = parsed.span;
        const parserTable = parsed.quoted.at(-1) ? from.table : from.table.toLowerCase();
        if (parserTable !== parsed.parts.at(-1)) {
          scopeComplete = false;
          if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'table_ast_source_mismatch', span }); continue;
        }
        const selected = chooseTable(parsed.parts), alias = parsed.alias || parsed.parts.at(-1);
        const binding = { alias, table: selected.table, reason: selected.reason };
        bindings.push(binding);
        const values = aliases.get(alias) || []; values.push(binding); aliases.set(alias, values);
        append(result, 'sqlTable', parsed.parts.join('.'), span, selected.table?.source || null, selected.reason, [],
          selected.table ? { schema: selected.table.schema, name: selected.table.name, kind: 'table' } : null);
      }
      const projections = Array.isArray(statement.columns) ? statement.columns : [];
      if (qualifier.columns.length !== projections.length) {
        if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'projection_source_ranges_unavailable', span: null }); continue;
      }
      for (const [projectionIndex, projection] of projections.entries()) {
        const node = projection?.expr, parsed = qualifier.columns[projectionIndex], span = parsed?.span || null;
        if (!parsed || node?.type !== 'column_ref' || parsed.parts.length > 2) {
          if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'column_scope_or_range_unsupported', span }); continue;
        }
        const parserColumn = typeof node.column === 'string' ? node.column : node.column?.expr?.value;
        if (typeof parserColumn !== 'string' || (parsed.quoted.at(-1) ? parserColumn : parserColumn.toLowerCase()) !== parsed.parts.at(-1)) {
          if (result.diagnostics.length < 32) result.diagnostics.push({ code: 'column_ast_source_mismatch', span }); continue;
        }
        const columnName = parsed.parts.at(-1), selected = parsed.parts.length === 2 ? aliases.get(parsed.parts[0]) || [] : bindings;
        const candidates = selected.flatMap(binding => binding.table?.columns.has(columnName)
          ? [{ schema: binding.table.schema, table: binding.table.name, column: columnName, source: binding.table.columns.get(columnName).source }] : []);
        const unique = scopeComplete && candidates.length === 1 && selected.every(binding => binding.table !== null);
        append(result, 'sqlColumn', parsed.parts.join('.'), span, unique ? candidates[0].source : null,
          !scopeComplete ? 'from_scope_unmapped' : candidates.length > 1 ? 'ambiguous_column' : selected.some(binding => !binding.table) ? 'from_table_unresolved' : 'catalog_column_unavailable', candidates);
      }
      if (entries.filter(node => node.type === 'column_ref').length > projections.filter(projection => projection?.expr?.type === 'column_ref').length
        && result.diagnostics.length < 32) result.diagnostics.push({ code: 'non_projection_column_ranges_unavailable', span: null });
    }
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'sql-offline-catalog', adapterVersion: '1',
    method: 'sql/offline-catalog', evidenceKind: 'sql-catalog-references', generation: JSON.parse(canonicalSemanticJson(generation)),
    runtime: { family: 'node-sql-parser', version, profileHash, qualification: 'application-library-unqualified' },
    project: { configHash, dependencyHash, catalogIdentity: identity, catalogContext: catalog.context },
    results: [...results.values()], coverage: { selectTableColumnSubset: true, databaseConnected: false, migrationsExecuted: false,
      functionOverloads: false, proceduralSql: false, temporaryObjects: false },
    metrics: { sourceBytes, nodeCount, referenceCount, columnCount, candidateCount, retainedReferenceBytes } };
  check();
  if (Buffer.byteLength(canonicalSemanticJson(report)) > 1024 * 1024) throw fail('SQL report output byte budget exhausted.');
  return { ...report, identity: semanticHash('tooling.source-linked-evidence.v1', report) };
};
