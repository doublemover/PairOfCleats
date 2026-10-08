import { hashCanonicalJson, normalizeConversation, normalizeEvidenceContent } from './normalize.js';
import { historyError } from './common.js';
const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid inference-history evidence record.');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.trim().length > 0;
export function normalizeHistoryRecord(raw, evidenceKind, limits) {
  if (evidenceKind === 'exported_conversation') {
    const value = normalizeConversation(raw, limits);
    return { ...value, recordId: value.conversationId, evidenceKind,
      nodes: value.nodes.map(node => ({ ...node, sourceRevision: hashCanonicalJson(raw.mapping[node.nodeId]) })) };
  }
  if (evidenceKind !== 'exported_codex_task') throw invalid();
  const snapshotHash = hashCanonicalJson(raw);
  if (!object(raw) || !id(raw.id) || typeof raw.title !== 'string'
    || typeof raw.archived !== 'boolean' || !Array.isArray(raw.turns)
    || raw.turns.length > limits.maxNodes) throw invalid();
  const diagnostics = [], seen = new Set();
  const nodes = raw.turns.map(turn => {
    if (!object(turn) || !id(turn.id) || seen.has(turn.id)
      || !(!Object.hasOwn(turn, 'input_items') || turn.input_items === null || Array.isArray(turn.input_items))
      || !(!Object.hasOwn(turn, 'output_items') || turn.output_items === null || Array.isArray(turn.output_items))) throw invalid();
    seen.add(turn.id);
    const parts = [], assets = [];
    for (const item of [...(turn.input_items ?? []), ...(turn.output_items ?? [])]) {
      if (!object(item)) throw invalid();
      let content = item.content;
      if (content === undefined && typeof item.body === 'string') content = item.body;
      if (content === undefined && typeof item.output_diff === 'string') content = { type: 'code', code: item.output_diff };
      if (Array.isArray(content)) content = { parts: content };
      const value = normalizeEvidenceContent(content, limits.maxTextChars,
        code => diagnostics.push({ code, nodeId: turn.id }));
      parts.push({ type: 'task_item', raw: item }, ...value.parts);
      assets.push(...normalizeEvidenceContent({ parts: [item] }, 0, () => {}).assets);
    }
    const sourceDetails = { archived: raw.archived };
    for (const field of ['role', 'branch', 'branch_name', 'external_pull_request_id', 'pull_request_status', 'turn_status']) {
      if (Object.hasOwn(turn, field)) sourceDetails[field] = turn[field];
    }
    return { nodeId: turn.id, messageId: null, parentId: id(turn.previous_turn_id) ? turn.previous_turn_id : null,
      children: [], role: typeof turn.role === 'string' ? turn.role : null, pathState: 'unknown',
      parts, assets, text: parts.filter(part => typeof part.text === 'string').map(part => part.text).join('\n').slice(0, limits.maxTextChars),
      createdAt: { utc: null, state: 'missing', raw: null }, sourceDetails, sourceRevision: hashCanonicalJson(turn) };
  });
  for (const node of nodes) {
    if (node.parentId && !seen.has(node.parentId)) diagnostics.push({ code: 'previous_turn_not_in_export', nodeId: node.nodeId });
  }
  return { recordId: raw.id, evidenceKind, snapshotHash, currentNode: null, diagnostics, nodes, raw };
}
