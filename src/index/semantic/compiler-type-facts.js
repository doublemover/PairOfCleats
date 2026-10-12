import { throwIfAborted } from '../../shared/abort.js';

const MAX_EXPRESSION_BYTES = 65536;
const MAX_FACT_BYTES = 1024 * 1024;
export const TYPE_FACT_SLOTS = Object.freeze(['local', 'parameter', 'field', 'return'].map(role => 'ast:TypeFact.' + role));

/** Source-pinned type observations; expression equality never implies assignability. */
export const emitCompilerTypeFacts = async ({ ts, checker, sourceFile, nodes, expressionFor,
  declarationFor, context, ref, evidence, allocate, signal = null }) => {
  const rows = [], reasons = new Set(), associations = new Set();
  let observedCount = 0, completedCount = 0, bytes = 0, visited = 0;
  let exhausted = false;
  const spanOf = node => [node.getStart(sourceFile), node.end];
  for (const node of nodes) {
    if (++visited % 128 === 0) {
      await new Promise(resolve => setImmediate(resolve)); throwIfAborted(signal);
    }
    if (visited > 16384) {
      reasons.add('type_fact_work_budget'); break;
    }
    const role = ts.isParameter(node) ? 'parameter' : ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ? 'field'
      : ts.isVariableDeclaration(node) ? 'local' : ts.isFunctionLike(node) && node.body ? 'return' : null;
    if (!role) continue;
    observedCount += 1;
    const owner = declarationFor(node) || expressionFor(node);
    if (!owner || owner.externalKey) { reasons.add('type_fact_owner_unavailable'); continue; }
    let complete = true;
    const emit = (expression, origin, lexicalNode) => {
      const associationKey = owner.partitionId + ':' + owner.localId + ':' + role + ':' + origin;
      if (associations.has(associationKey)) return;
      if (typeof expression !== 'string' || !expression.trim() || Buffer.byteLength(expression) > MAX_EXPRESSION_BYTES
        || origin !== 'declared' && /\.\.\.\s+\d+\s+more\b|\bmore\s+\.\.\./.test(expression)) {
        complete = false; reasons.add('type_fact_expression_budget_or_truncation'); return;
      }
      let span = spanOf(lexicalNode || node);
      if (origin !== 'declared') {
        span = node.name ? spanOf(node.name) : [span[0], Math.min(span[1], span[0] + 1)];
      }
      const placeholder = ref(Number.MAX_SAFE_INTEGER);
      const additions = [{ family: 'node', row: { id: placeholder.localId, kind: 'type', span, scope: owner,
        data: { origin, textRef: { span }, compilerContextKey: origin === 'declared' ? null : context.contextKey,
          expression: expression.trim() } } },
      { family: 'operand', row: { parent: owner, slot: 'ast:TypeFact.' + role,
        ordinal: origin === 'declared' ? 0 : 1, child: placeholder, flags: [] } }];
      if (origin !== 'declared') additions.push({ family: 'edge', row: {
        id: 0, kind: 'evidenceInput', from: placeholder, to: evidence, callSite: null,
        operandOrdinal: null, contextKey: context.contextKey, condition: null, evidence, certainty: 'exact-static'
      } });
      const size = Buffer.byteLength(JSON.stringify(additions));
      if (bytes + size > MAX_FACT_BYTES) { complete = false; exhausted = true; reasons.add('type_fact_total_byte_budget'); return; }
      const fact = allocate();
      associations.add(associationKey);
      additions[0].row.id = fact.localId; additions[1].row.child = fact;
      if (additions[2]) additions[2].row.from = fact;
      rows.push(...additions); bytes += size;
    };
    if (node.type) {
      const span = spanOf(node.type);
      if (span[1] - span[0] > MAX_EXPRESSION_BYTES) {
        complete = false; reasons.add('declared_type_expression_budget');
      } else emit(sourceFile.text.slice(span[0], span[1]), 'declared', node.type);
    }
    if (!exhausted) try {
      const signature = role === 'return' ? checker.getSignatureFromDeclaration(node) : null;
      const type = role === 'return' ? signature && checker.getReturnTypeOfSignature(signature)
        : checker.getTypeAtLocation(node.name || node);
      if (!type) { complete = false; reasons.add('checker_type_unavailable'); }
      // The compiler's default formatting limit stays enabled. Never request
      // NoTruncation or expand aliases to turn a bounded fact into an arena dump.
      else emit(checker.typeToString(type, node, 0), 'checker-inferred', node);
    } catch {
      complete = false; reasons.add('checker_type_failure');
    }
    if (complete) completedCount += 1;
    if (exhausted) break;
  }
  throwIfAborted(signal);
  // The ref callback identifies the allocator's partition; reject inconsistent
  // producer wiring before any partition can be admitted.
  const partitionId = rows.find(entry => entry.family === 'operand')?.row.child.partitionId;
  if (rows.some(entry => entry.family === 'node' && ref(entry.row.id).partitionId !== partitionId)) {
    throw new Error('Type fact allocator/ref partition mismatch.');
  }
  return { rows, structuralSlots: [...TYPE_FACT_SLOTS], reasons: [...reasons].sort(), observedCount, completedCount };
};
