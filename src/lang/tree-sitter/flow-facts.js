import { createFlowEvidence, flowSourceIdentity } from '../../shared/flow-evidence.js';
import { getNamedChild, getNamedChildCount } from './ast.js';

export const NATIVE_FLOW_FACTS_VERSION = 1;
export const MANAGED_NATIVE_FLOW_LANGUAGES = new Set(['dart', 'scala', 'groovy', 'julia', 'r']);
// These are named syntax roles, never text probes. This is deliberately a
// partial control/effect subset, not semantic reads/writes/aliases or a CFG.
const roles = new Map([
  ['branches', ['if_statement', 'if_expression', 'switch_statement', 'switch_expression', 'match_expression', 'when_expression', 'catch_clause']],
  ['loops', ['for_statement', 'for_expression', 'while_statement', 'while_expression', 'do_statement', 'do_while_statement', 'enhanced_for_statement']],
  ['returns', ['return_statement', 'return_expression']], ['breaks', ['break_statement', 'break_expression']],
  ['continues', ['continue_statement', 'continue_expression']], ['throws', ['throw_statement', 'throw_expression']],
  ['awaits', ['await_expression']], ['yields', ['yield_statement', 'yield_expression']]
].flatMap(([kind, types]) => types.map(type => [type, kind])));
const comments = new Set(['comment', 'line_comment', 'block_comment']);

/** Share the existing native owner traversal; retain no nodes/tree handles. */
export const createOwnedNativeFlow = ({ text, languageId, chunks }) => {
  const records = new Map(), context = {};
  for (const chunk of chunks) {
    if (!/Function|Method|Constructor|Initializer|Deinitializer/.test(chunk.kind)) continue;
    const start = chunk.meta?.bodyStart, end = chunk.meta?.bodyEnd;
    const bodyKnown = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= chunk.start && end <= chunk.end && end > start;
    records.set(chunk, { start, end, bodyKnown, returnsValue: false,
      counts: { branches: 0, loops: 0, returns: 0, breaks: 0, continues: 0, throws: 0, awaits: 0, yields: 0 } });
  }
  return {
    observe(owner, node) {
      const record = records.get(owner);
      if (!record?.bodyKnown || node.startIndex < record.start || node.endIndex > record.end) return;
      const kind = roles.get(node.type);
      if (!kind) return;
      record.counts[kind]++;
      if (kind === 'returns') for (let i = 0; i < getNamedChildCount(node); i++) {
        if (!comments.has(getNamedChild(node, i)?.type)) { record.returnsValue = true; break; }
      }
    },
    finish({ truncated = false, parserRecovered = false } = {}) {
      for (const [chunk, record] of records) {
        const values = record.bodyKnown ? { controlFlow: record.counts, returnsValue: record.returnsValue,
          throws: record.counts.throws ? ['throw'] : [], awaits: record.counts.awaits ? ['await'] : [], yields: record.counts.yields > 0 } : {};
        const reasons = [record.bodyKnown ? 'recognized_native_syntax_subset' : 'native_flow_body_unavailable',
          ...(truncated ? ['native_traversal_budget'] : []), ...(parserRecovered ? ['native_parser_recovery'] : [])];
        const states = Object.fromEntries(['controlFlow', 'throws', 'awaits', 'yields', 'returnsValue'].map(field => [field, record.bodyKnown ? 'partial' : 'unavailable']));
        states.dataflow = 'unavailable';
        const flowEvidence = createFlowEvidence({ values, source: flowSourceIdentity({ text, chunk, languageId, context }),
          producer: { id: 'native-owned-control-syntax:' + languageId, version: String(NATIVE_FLOW_FACTS_VERSION) }, authority: 'syntax',
          scope: 'recognized-native-control-node-roles-v1', states, reasons });
        chunk.meta.syntaxFlow = Object.freeze({ ...values, flowEvidence });
        Object.freeze(record.counts);
        if (values.throws) Object.freeze(values.throws);
        if (values.awaits) Object.freeze(values.awaits);
      }
    }
  };
};
