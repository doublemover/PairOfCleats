import { createHash } from 'node:crypto';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { getJavaScriptSyntaxIdentity, ownsJavaScriptSyntaxText } from './parse.js';
import { JAVASCRIPT_RELATIONS_VERSION } from './version.js';
import { createJavaScriptDocCommentOwner } from './doc-comments.js';

export { JAVASCRIPT_RELATIONS_VERSION } from './version.js';
const snapshots = new WeakMap(), admissions = new WeakMap();
const digest = value => createHash('sha256').update(value).digest('hex');
const span = node => {
  const start = node?.start ?? node?.range?.[0], end = node?.end ?? node?.range?.[1];
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start ? { start, end } : null;
};
const key = range => range ? `${range.start}:${range.end}` : null;
const fail = message => Object.assign(new Error(message), { code: 'ERR_JS_DECLARATION_OCCURRENCE' });

/** Borrow the already prepared AST's exact source identity. No native/AST handle
 * appears in the serializable snapshot or declaration records. */
export const javascriptDeclarationSource = (ast, text) => {
  const cached = ast && snapshots.get(ast);
  if (cached?.text === text) return cached.source;
  const parser = getJavaScriptSyntaxIdentity(ast);
  const owned = ownsJavaScriptSyntaxText(ast, text), qualified = owned && !ast.errors?.length;
  const source = Object.freeze({ encoding: 'utf16le-js-string', length: text.length,
    textHash: owned ? digest(Buffer.from(text, 'utf16le')) : null, parser: parser ? Object.freeze({ family: parser.family, version: parser.version }) : null,
    state: qualified ? 'qualified' : 'unavailable' });
  if (ast && typeof ast === 'object') snapshots.set(ast, { text, source });
  return source;
};

const association = (node, parent) => {
  if (parent?.type === 'VariableDeclarator' && parent.init === node) return 'variable-initializer';
  if (parent?.type === 'AssignmentExpression' && parent.right === node) return 'assignment-value';
  if (['MethodDefinition', 'PropertyDefinition', 'ClassProperty', 'ClassPrivateProperty', 'Property', 'ObjectProperty'].includes(parent?.type)
    && parent.value === node) return 'member-value';
  if (['ExportDefaultDeclaration', 'ExportNamedDeclaration'].includes(parent?.type) && parent.declaration === node) return 'export-declaration';
  return null;
};
export const declarationRole = (node, parent) => {
  const method = ['ClassMethod', 'ClassPrivateMethod', 'ObjectMethod'].includes(node.type) ? node
    : parent?.type === 'MethodDefinition' || parent?.type === 'Property' && (parent.method || ['get', 'set'].includes(parent.kind)) ? parent : null;
  if (method) return `${method.static ? 'static' : 'instance'}:${method.kind === 'init' && method.method ? 'method' : method.kind || 'method'}:${node.type}`;
  if (['ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition'].includes(parent?.type)) return `${parent.static ? 'static' : 'instance'}:field-value:${node.type}`;
  return node.type;
};
export const javascriptDeclarationReference = (ast, text, node, parent = null) => {
  const source = javascriptDeclarationSource(ast, text), range = span(node);
  if (!range || range.end > text.length) return null;
  const role = declarationRole(node, parent);
  const id = 'jsdecl1:' + digest(stableStringifyForSignature({ producer: JAVASCRIPT_RELATIONS_VERSION, source, range, role }));
  const wrapper = association(node, parent), wrapperRange = wrapper ? span(parent) : null;
  return Object.freeze({ id, sourceHash: source.textHash, range, role,
    associations: Object.freeze([{ kind: 'declaration', range }, ...(wrapperRange ? [{ kind: wrapper, range: wrapperRange }] : [])]) });
};

export const createJavaScriptDeclarationCatalog = (ast, text) => {
  const source = javascriptDeclarationSource(ast, text);
  const documentation = createJavaScriptDocCommentOwner(ast, text);
  let declarations = 0;
  const catalog = { schemaVersion: 1, producerVersion: JAVASCRIPT_RELATIONS_VERSION, source,
    records: Object.create(null), rangeOwners: Object.create(null), nameOwners: Object.create(null),
    coverage: { state: source.state === 'qualified' ? 'complete' : 'unavailable', reasons: source.state === 'qualified' ? [] : ['source_parser_unqualified'],
      maxDeclarations: 10000, maxAssociationsPerDeclaration: 2, maxTraversalSteps: 250000, maxQueuedSteps: 50000, visitedSteps: 0, omittedDeclarations: null } };
  const add = (node, parent, { displayName, parentId = null, metadata, kind = 'callable' }) => {
    const reference = javascriptDeclarationReference(ast, text, node, parent);
    if (!reference) { partial('declaration_range_unavailable'); return null; }
    if (Object.hasOwn(catalog.records, reference.id)) return catalog.records[reference.id];
    if (declarations >= catalog.coverage.maxDeclarations) { partial('declaration_admission_limit'); return null; }
    const record = { ...reference, kind, displayName, internalName: node.id?.name || null, parentId, metadata,
      documentation: documentation.forDeclaration(reference.associations) };
    catalog.records[record.id] = record;
    declarations++;
    for (const value of record.associations) (catalog.rangeOwners[key(value.range)] ||= []).push(record.id);
    if (displayName && displayName !== '(anonymous)') (catalog.nameOwners[displayName] ||= []).push(record.id);
    return record;
  };
  const partial = reason => {
    catalog.coverage.state = source.state === 'qualified' ? 'partial' : 'unavailable';
    if (!catalog.coverage.reasons.includes(reason) && catalog.coverage.reasons.length < 16) catalog.coverage.reasons.push(reason);
  };
  return { catalog, add, partial };
};

/** Range aliases are explicit AST associations, never a name or containment
 * search. A split may retain its original declaration reference, but its full
 * declaration aggregate is not a local-flow fact for that fragment. */
export const resolveJavaScriptDeclaration = (text, chunk, catalog) => {
  if (!catalog || catalog.schemaVersion !== 1 || catalog.producerVersion !== JAVASCRIPT_RELATIONS_VERSION
    || catalog.source?.state !== 'qualified' || !catalog.source.textHash) return { state: 'unavailable', reason: 'source_declaration_catalog_unavailable' };
  let checked = admissions.get(catalog);
  if (checked?.text !== text) {
    checked = { text, matches: catalog.source.length === text.length && digest(Buffer.from(text, 'utf16le')) === catalog.source.textHash };
    admissions.set(catalog, checked);
  }
  if (!checked.matches) throw fail('Declaration catalog belongs to another source snapshot.');
  return resolveJavaScriptDeclarationReference(chunk, catalog);
};

export const resolveJavaScriptDeclarationReference = (chunk, catalog) => {
  if (catalog?.schemaVersion !== 1 || catalog?.producerVersion !== JAVASCRIPT_RELATIONS_VERSION
    || catalog?.source?.state !== 'qualified' || !catalog.source.textHash) return { state: 'unavailable', reason: 'source_declaration_catalog_unavailable' };
  if (!Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end) || chunk.start < 0
    || chunk.end <= chunk.start || chunk.end > catalog.source.length) return { state: 'unavailable', reason: 'declaration_projection_range_unavailable' };
  const retained = chunk.meta?.jsDeclaration;
  const nativeRange = Number.isSafeInteger(chunk.meta?.definitionStart) && Number.isSafeInteger(chunk.meta?.definitionEnd)
    ? { start: chunk.meta.definitionStart, end: chunk.meta.definitionEnd } : null;
  let candidates;
  if (retained) {
    if (retained.sourceHash !== catalog.source.textHash) throw fail('Chunk declaration belongs to another source.');
    candidates = [retained.id];
  } else {
    candidates = catalog.rangeOwners[key(nativeRange || chunk)] || [];
  }
  const records = [...new Set(candidates)].map(id => catalog.records[id]).filter(Boolean);
  const kind = /Class/u.test(chunk.kind) && !/Function|Method/u.test(chunk.kind) ? 'class'
    : /Function|Method|Arrow/u.test(chunk.kind) ? 'callable' : /Module|Root/u.test(chunk.kind) ? 'module' : null;
  const eligible = kind ? records.filter(record => record.kind === kind) : records;
  if (eligible.length !== 1) return { state: eligible.length ? 'ambiguous' : 'unavailable', reason: 'declaration_range_association_unavailable' };
  const record = eligible[0];
  if (retained && (retained.range.start !== record.range.start || retained.range.end !== record.range.end || retained.role !== record.role)) throw fail('Chunk declaration association differs from its catalog.');
  const containing = record.associations.find(value => chunk.start >= value.range.start && chunk.end <= value.range.end);
  const exact = record.associations.some(value => chunk.start === value.range.start && chunk.end === value.range.end)
    || Boolean(retained || nativeRange && record.associations.some(value => key(value.range) === key(nativeRange)))
      && chunk.start <= record.range.start && chunk.end >= record.range.end;
  if (!containing && !exact) return { state: 'unavailable', reason: 'declaration_projection_range_unavailable' };
  return { state: catalog.coverage.state === 'complete' && exact ? 'qualified' : 'partial', reason: exact ? null : 'split_declaration_flow_unavailable', record, exact };
};
