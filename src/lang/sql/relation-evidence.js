import { createHash } from 'node:crypto';

import { SQL_RELATION_PRODUCER_VERSION } from './version.js';
import { sqlRelationDisplay, sqlRelationNameIdentity, sqlRelationOccurrenceIdentity } from '../../contracts/sql-relation-identities.js';
const roles = new Set(['select', 'insert', 'replace', 'update', 'delete', 'create', 'alter']);

export const createSqlRelationEvidence = (text, dialect, parserVersion, qualifyText = true) => ({
  textLength: text.length, schemaVersion: 1, producerVersion: SQL_RELATION_PRODUCER_VERSION, dialect, parserVersion,
  textHash: qualifyText ? createHash('sha256').update(text, 'utf16le').digest('hex') : null, textHashEncoding: 'utf16le-js-string',
  identifierPolicy: 'parser-decoded-segments;quote-and-catalog-binding-unqualified',
  coverage: { state: 'partial', recognition: 'unavailable', reasons: {},
    scope: ['statement-relation-heads', 'cte-references', 'derived-bindings', 'query-alias-observations', 'column-qualifiers'],
    catalogBinding: 'not-attempted', omittedOccurrences: null },
  counts: { nodesVisited: 0, statements: 0, retainedOccurrences: 0 }, occurrences: []
});

export const noteSqlRelationCoverage = (evidence, reason) => {
  const reasons = evidence.coverage.reasons;
  if (Object.hasOwn(reasons, reason) || Object.keys(reasons).length < 16) reasons[reason] = (reasons[reason] || 0) + 1;
};

/** Project declared AST roles only. Parser summary strings and column qualifiers
 * never become physical relation names. No source token is decoded a second time.
 * AST paths/text hashes identify occurrences; decoded name IDs are observations,
 * not catalog bindings or a claim about lost lexical quoting/case semantics. */
export const projectSqlRelationEvidence = (ast, evidence, text) => {
  const allRoots = Array.isArray(ast) ? ast : [ast], roots = allRoots.slice(0, 4096), seen = new WeakSet();
  if (allRoots.length > roots.length) noteSqlRelationCoverage(evidence, 'ast_budget');
  const pending = roots.map((node, index) => ({ node, path: `$[${index}]`, scope: null, statement: true, depth: 0 })).reverse();
  let retainedBytes = 0, queueExhausted = false;
  const enqueue = frame => {
    if (pending.length + evidence.counts.nodesVisited >= 32768) { queueExhausted = true; noteSqlRelationCoverage(evidence, 'ast_budget'); return false; }
    pending.push(frame); return true;
  };
  const span = node => {
    const start = node?.loc?.start?.offset, end = node?.loc?.end?.offset;
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end <= text.length ? [start, end] : null;
  };
  const parts = node => {
    if (!node || typeof node.table !== 'string' || !node.table) return null;
    const output = [];
    for (const key of ['db', 'schema', 'table']) {
      if (node[key] == null) continue;
      if (typeof node[key] !== 'string' || !node[key] || node[key].length > 1024) {
        noteSqlRelationCoverage(evidence, 'identifier_shape_unsupported'); return null;
      }
      output.push(node[key]);
    }
    return output;
  };
  const emit = (role, values, node, path, scope, alias = null) => {
    if (alias !== null && alias.length > 1024) { noteSqlRelationCoverage(evidence, 'identifier_shape_unsupported'); return false; }
    const occurrence = { role, parts: values, alias, statementScope: scope.id, astPath: path, span: span(node),
      decodedNameId: values.length ? sqlRelationNameIdentity(evidence.dialect, values) : null,
      display: values.length ? sqlRelationDisplay(values) : alias };
    occurrence.occurrenceId = sqlRelationOccurrenceIdentity(evidence, occurrence);
    const bytes = Buffer.byteLength(JSON.stringify(occurrence));
    if (evidence.occurrences.length >= 4096 || retainedBytes + bytes > 512 * 1024) {
      noteSqlRelationCoverage(evidence, 'occurrence_budget'); return false;
    }
    evidence.occurrences.push(occurrence); retainedBytes += bytes; return true;
  };
  let headsVisited = 0;
  const table = (node, path, scope, declaration = false, depth = 0) => {
    if (++headsVisited > 32768 || depth > 128) { noteSqlRelationCoverage(evidence, 'ast_budget'); return; }
    if (!node || typeof node !== 'object') { noteSqlRelationCoverage(evidence, 'relation_head_shape_unsupported'); return; }
    const values = parts(node);
    if (values && !node.expr) {
      const local = !declaration && values.length === 1 && scope.ctes.has(values[0].toLowerCase());
      if (local) noteSqlRelationCoverage(evidence, 'cte_scope_conservative');
      if (values.length === 1 && scope.unknownCteScope && !declaration) {
        noteSqlRelationCoverage(evidence, 'cte_scope_unavailable');
        emit('unqualified-relation-reference', values, node, path, scope);
      } else emit(declaration ? 'relation-declaration' : local ? 'cte-reference-candidate' : 'relation-use', values, node, path, scope);
    } else if (node.expr) {
      emit('derived-binding', [], node, path, scope);
      noteSqlRelationCoverage(evidence, 'derived_scope_partial');
      if (node.expr.type === 'tables' && Array.isArray(node.expr.expr)) {
        for (const [index, member] of node.expr.expr.entries()) {
          if (evidence.coverage.reasons.occurrence_budget) break;
          if (headsVisited >= 32768) { noteSqlRelationCoverage(evidence, 'ast_budget'); break; }
          table(member, `${path}.expr.expr[${index}]`, scope, false, depth + 1);
        }
      }
    } else noteSqlRelationCoverage(evidence, 'relation_head_shape_unsupported');
    if (typeof node.as === 'string' && node.as) emit('query-alias', [], node, path + '.as', scope, node.as);
  };
  while (pending.length && !queueExhausted) {
    const frame = pending.pop(), { node, path, depth } = frame;
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    if (depth > 128 || evidence.counts.nodesVisited >= 32768) { noteSqlRelationCoverage(evidence, 'ast_budget'); break; }
    if (evidence.coverage.reasons.occurrence_budget) break;
    seen.add(node); evidence.counts.nodesVisited++;
    let scope = frame.scope;
    const statement = frame.statement || node.type === 'select' && Array.isArray(node.columns);
    if (statement) {
      evidence.counts.statements++;
      scope = { id: path, ctes: new Set(scope?.ctes || []), unknownCteScope: scope?.unknownCteScope || false };
      if (node.with != null) {
        if (!Array.isArray(node.with)) scope.unknownCteScope = true;
        else for (const cte of node.with) {
          const name = typeof cte?.name === 'string' ? cte.name : cte?.name?.value;
          if (typeof name === 'string' && name && scope.ctes.size < 4096) scope.ctes.add(name.toLowerCase());
          else { scope.unknownCteScope = true; noteSqlRelationCoverage(evidence, 'cte_scope_unavailable'); }
        }
        // Full recursive/forward visibility and catalog case binding are outside
        // this lexical occurrence subset. Never invent a physical CTE table.
        noteSqlRelationCoverage(evidence, 'cte_scope_conservative');
      }
      if (!roles.has(node.type)) noteSqlRelationCoverage(evidence, 'statement_role_unsupported');
      else {
        const createKind = String(node.keyword || '').toLowerCase();
        const declaration = node.type === 'create' && ['table', 'view'].includes(createKind);
        const supportedHead = (node.type !== 'create' || ['table', 'view', 'index'].includes(createKind))
          && (node.type !== 'alter' || createKind === 'table');
        if (!supportedHead) noteSqlRelationCoverage(evidence, 'statement_role_unsupported');
        const heads = !supportedHead ? null : ['select', 'delete'].includes(node.type) ? node.from : node.table;
        if (heads != null) {
          const list = Array.isArray(heads) ? heads : [heads];
          for (const [index, head] of list.entries()) {
            if (evidence.coverage.reasons.occurrence_budget) break;
            if (headsVisited >= 32768) { noteSqlRelationCoverage(evidence, 'ast_budget'); break; }
            table(head, `${path}.${['select', 'delete'].includes(node.type) ? 'from' : 'table'}[${index}]`, scope, declaration);
          }
        }
        if (node.type !== 'select') noteSqlRelationCoverage(evidence, 'non_select_statement_edges_partial');
      }
    }
    if (scope && node.type === 'column_ref' && node.table != null) {
      const values = parts(node);
      if (values) emit('column-qualifier', values, node, path, scope);
      else noteSqlRelationCoverage(evidence, 'column_qualifier_shape_unsupported');
    }
    const entries = Object.entries(node).filter(([key]) => !['loc', 'tableList', 'columnList'].includes(key));
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (let child = value.length - 1; child >= 0; child--) if (value[child] && typeof value[child] === 'object') {
          if (!enqueue({ node: value[child], path: `${path}.${key}[${child}]`, depth: depth + 1, scope, statement: false })) break;
        }
      } else enqueue({ node: value, path: `${path}.${key}`, depth: depth + 1, scope, statement: key === 'ast' || key === '_next' });
      if (queueExhausted) break;
    }
  }
  evidence.counts.retainedOccurrences = evidence.occurrences.length;
  const uncertain = Object.keys(evidence.coverage.reasons).some(reason => !['non_select_statement_edges_partial', 'cte_scope_conservative', 'derived_scope_partial'].includes(reason));
  evidence.coverage.recognition = evidence.occurrences.some(row => row.role === 'relation-use') ? 'recognized-nonempty' : uncertain ? 'partial-empty' : 'recognized-empty';
  return evidence;
};

export const sqlPhysicalUsageDisplays = evidence => [...new Set((evidence?.occurrences || [])
  .filter(row => row.role === 'relation-use').map(row => row.display))].sort();
