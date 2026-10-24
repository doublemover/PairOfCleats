import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { finalizeSourceLinkedReport } from './source-linked-report.js';

const require = createRequire(import.meta.url);
const SUPPORTED_GRAPHQL_VERSION = '16.12.0';
const fail = message => Object.assign(new Error(message), { code: 'ERR_GRAPHQL_LINKED_EVIDENCE' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const safePath = value => typeof value === 'string' && value && !value.includes('\\') && !value.includes(':')
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..');

export const GRAPHQL_LINKED_PROVIDER_DECLARATION = Object.freeze({ schemaVersion: 1,
  providerId: 'graphql-local-schema', adapterVersion: '2', execution: 'trusted-inprocess',
  languages: [{ id: 'graphql', dialect: null }],
  facts: [{ family: 'references', evidence: 'source-qualified' }, { family: 'diagnostics', evidence: 'provider-observation' }],
  consumers: [{ id: 'navigation', families: ['references'], partialPolicy: 'qualified', fallback: 'parser' },
    { id: 'semanticDetail', families: ['references', 'diagnostics'], partialPolicy: 'qualified', fallback: 'parser' }],
  contextRequirements: ['source-snapshot', 'project-variant', 'dependency-closure'],
  limits: { maxRequests: 1, maxFacts: 4096, maxBytes: 500 * 1024, wallMs: 1000 }, prerequisites: [] });

/** Link only explicitly supplied local schema/document snapshots. The app-owned
 * GraphQL library constructs schemas and validates ASTs; resolvers, project
 * configuration modules, remote introspection and import fetching never run. */
export const collectGraphqlLinkedEvidence = ({ documents, schemaPaths, documentPaths, generation,
  configHash, dependencyHash, profileHash = null, maxDocuments = 20, maxSourceBytes = 500 * 1024,
  maxNodes = 32768, maxReferences = 4096, maxDepth = 128, maxMs = 1000, signal = null }) => {
  if (!(documents instanceof Map) || !documents.size || !Number.isSafeInteger(maxDocuments)
    || maxDocuments < 1 || maxDocuments > 20 || documents.size > maxDocuments
    || !Array.isArray(schemaPaths) || !schemaPaths.length || !Array.isArray(documentPaths)
    || schemaPaths.length + documentPaths.length !== documents.size
    || new Set([...schemaPaths, ...documentPaths]).size !== documents.size
    || !digest(configHash) || !digest(dependencyHash) || (profileHash !== null && !digest(profileHash))
    || !generation || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1 || maxSourceBytes > 500 * 1024
    || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 32768
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 128
    || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid local GraphQL evidence inputs or bounds.');
  const started = performance.now();
  const check = () => { throwIfAborted(signal); if (performance.now() - started >= maxMs) throw fail('GraphQL evidence time budget exhausted.'); };
  check();
  const graphql = require('graphql');
  if (graphql.version !== SUPPORTED_GRAPHQL_VERSION) throw fail('GraphQL library version is not qualified by this adapter profile.');
  const snapshots = new Map(), parsed = new Map(), results = new Map();
  let sourceBytes = 0, nodes = 0, referenceCount = 0, namespace = null;
  for (const filename of [...schemaPaths, ...documentPaths]) {
    check();
    const item = documents.get(filename), source = item?.source;
    if (!safePath(filename) || source?.path !== filename || typeof item.text !== 'string'
      || createHash('sha256').update(item.text).digest('hex') !== source.byteHash
      || (namespace !== null && source.repositoryNamespace !== namespace)) throw fail('GraphQL input differs from its original source snapshot or repository.');
    namespace = source.repositoryNamespace;
    if (source.mapping && source.mapping.quality !== 'exact') throw fail('GraphQL input source mapping is not exact.');
    if (item.facts && canonicalSemanticJson(item.facts.storage.generation) !== canonicalSemanticJson(generation)) throw fail('GraphQL inputs span different generations.');
    sourceBytes += Buffer.byteLength(item.text);
    if (sourceBytes > maxSourceBytes) throw fail('GraphQL source byte budget exhausted.');
    snapshots.set(filename, item);
    const result = { path: filename, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      state: 'partial', reason: 'application_library_profile_unqualified', references: [], diagnostics: [] };
    results.set(filename, result);
    try {
      const ast = graphql.parse(new graphql.Source(item.text, filename), { maxTokens: maxNodes });
      const pending = [{ node: ast, depth: 0 }];
      while (pending.length) {
        check();
        const { node, depth } = pending.pop();
        if (++nodes > maxNodes || depth > maxDepth) throw fail('GraphQL AST node/depth budget exhausted.');
        for (const [key, value] of Object.entries(node)) {
          if (key === 'loc') continue;
          if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child === 'object') pending.push({ node: child, depth: depth + 1 });
          } else if (value && typeof value === 'object') pending.push({ node: value, depth: depth + 1 });
        }
      }
      parsed.set(filename, ast);
    } catch (error) {
      if (error.code === 'ERR_GRAPHQL_LINKED_EVIDENCE' || error.name === 'AbortError') throw error;
      if (['that', 'than'].some(word => error.message === `Syntax Error: Document contains more ${word} ${maxNodes} tokens. Parsing aborted.`)) throw fail('GraphQL token budget exhausted.');
      result.diagnostics.push({ code: 'syntax_error', message: String(error.message || error).slice(0, 2048), spans: [] });
      result.reason = 'syntax_error';
    }
  }
  const location = node => {
    const filename = node?.loc?.source?.name, item = snapshots.get(filename), span = [node?.loc?.start, node?.loc?.end];
    if (!item || !span.every(value => Number.isSafeInteger(value) && value >= 0) || span[0] > span[1] || span[1] > item.text.length) return null;
    for (const offset of span) if (offset > 0 && offset < item.text.length
      && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])) return null;
    return { path: filename, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, span };
  };
  const diagnostic = (error, code) => {
    const spans = (error.nodes || []).slice(0, 8).map(node => location(node.name || node)).filter(Boolean);
    const filenames = new Set(spans.map(value => value.path));
    if (!filenames.size) for (const filename of schemaPaths) filenames.add(filename);
    for (const filename of filenames) {
      const result = results.get(filename);
      if (result.diagnostics.length < 32) result.diagnostics.push({ code, message: String(error.message || error).slice(0, 2048), spans });
    }
  };
  let schema = null;
  if (schemaPaths.every(filename => parsed.has(filename))) {
    try {
      check();
      const schemaAst = graphql.concatAST(schemaPaths.map(filename => parsed.get(filename)));
      schema = graphql.buildASTSchema(schemaAst);
      const errors = graphql.validateSchema(schema);
      for (const error of errors.slice(0, 32)) diagnostic(error, 'schema_validation_error');
      if (errors.length) schema = null;
      check();
    } catch (error) {
      if (error.code === 'ERR_GRAPHQL_LINKED_EVIDENCE' || error.name === 'AbortError') throw error;
      diagnostic(error, 'schema_validation_error');
      schema = null;
    }
  }
  const fragments = new Map();
  for (const filename of documentPaths) for (const node of parsed.get(filename)?.definitions || []) {
    if (node.kind !== 'FragmentDefinition') continue;
    const entries = fragments.get(node.name.value) || []; entries.push(node); fragments.set(node.name.value, entries);
  }
  if (schema) {
    const executableAst = graphql.concatAST(documentPaths.map(filename => parsed.get(filename)).filter(Boolean));
    for (const error of graphql.validate(schema, executableAst, undefined, { maxErrors: 32 })) diagnostic(error, 'operation_validation_error');
    const append = (node, family, name, targetNode, unresolved = 'schema_definition_unavailable') => {
      check();
      if (++referenceCount > maxReferences) throw fail('GraphQL reference budget exhausted.');
      const from = location(node.name || node), target = location(targetNode?.name || targetNode);
      if (!from) throw fail('GraphQL reference has no exact original source span.');
      results.get(from.path).references.push({ family, name, span: from.span, target,
        state: target ? 'resolved' : 'unresolved', reason: target ? null : unresolved });
    };
    for (const filename of documentPaths) {
      const ast = parsed.get(filename);
      if (!ast) continue;
      const typeInfo = new graphql.TypeInfo(schema);
      graphql.visit(ast, graphql.visitWithTypeInfo(typeInfo, {
        Field(node) { const field = typeInfo.getFieldDef(); append(node, 'field', node.name.value, field?.astNode); },
        Argument(node) { append(node, 'argument', node.name.value, typeInfo.getArgument()?.astNode); },
        NamedType(node) { append(node, 'type', node.name.value, schema.getType(node.name.value)?.astNode); },
        Directive(node) { append(node, 'directive', node.name.value, schema.getDirective(node.name.value)?.astNode); },
        EnumValue(node) { append(node, 'enumValue', node.value, typeInfo.getEnumValue()?.astNode); },
        FragmentSpread(node) { const candidates = fragments.get(node.name.value) || [];
          append(node, 'fragment', node.name.value, candidates.length === 1 ? candidates[0] : null,
            candidates.length > 1 ? 'ambiguous_fragment_name' : 'missing_fragment'); }
      }));
    }
    for (const filename of schemaPaths) {
      const ast = parsed.get(filename);
      if (ast) graphql.visit(ast, { NamedType(node) { append(node, 'type', node.name.value, schema.getType(node.name.value)?.astNode); } });
    }
  }
  for (const result of results.values()) {
    result.references.sort((left, right) => left.span[0] - right.span[0] || left.family.localeCompare(right.family));
    if (!schema && result.reason !== 'syntax_error') result.reason = 'schema_unavailable';
    else if (result.diagnostics.length) result.reason = 'validation_diagnostics';
    else if (result.references.some(value => value.state !== 'resolved')) result.reason = 'unresolved_schema_references';
    // The supplied profile hash is retained provenance. Current app-library
    // loading is not yet bound to an observed module closure, so all evidence
    // remains qualified and never becomes complete compiler binding coverage.
  }
  const report = { schemaVersion: 1, kind: 'source-linked-evidence', producerId: 'graphql-local-schema', adapterVersion: '2',
    method: 'graphql/local-schema', evidenceKind: 'graphql-schema-references', generation: JSON.parse(canonicalSemanticJson(generation)),
    runtime: { family: 'graphql-js', version: graphql.version, profileHash, qualification: 'application-library-unqualified' },
    project: { configHash, dependencyHash }, results: [...results.values()],
    coverage: { schemaConstructed: Boolean(schema), operationValidation: Boolean(schema), remoteIntrospection: false, runtimeCallFlow: false },
    metrics: { sourceBytes, nodes, referenceCount } };
  check();
  return finalizeSourceLinkedReport(report, { maxBytes: GRAPHQL_LINKED_PROVIDER_DECLARATION.limits.maxBytes,
    fail, message: 'GraphQL report output byte budget exhausted.', check });
};
