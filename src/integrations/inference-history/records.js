import { classifyArchiveSource } from './archive-structure.js';
import {redactHistoryText} from './common.js';
import {hasHiddenTraceMarker} from './artifact-projection.js';
import { hashCanonicalJson, normalizeConversation, normalizeEvidenceContent, normalizeTimestamp } from './normalize.js';
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
  if(evidenceKind==='recovered_artifact'){
    const allowed=['id','title','body','visibility','artifact_kind','created_at','provenance'];
    if(!object(raw)||Object.keys(raw).some(key=>!allowed.includes(key))||!id(raw.id)||typeof raw.title!=='string'
      ||typeof raw.body!=='string'||raw.body.length>limits.maxTextChars||raw.visibility!=='visible'
      ||!['document','code','activity','tool_activity','metadata'].includes(raw.artifact_kind)
      ||!object(raw.provenance)||Object.keys(raw.provenance).some(key=>!['source_sha256','locator','chunk_start','chunk_end','total_chars','date_basis','offset_basis','transformation'].includes(key))||!/^[a-f0-9]{64}$/.test(raw.provenance.source_sha256??'')
      ||raw.provenance.chunk_end-raw.provenance.chunk_start!==raw.body.length||raw.provenance.chunk_end>raw.provenance.total_chars
      ||raw.provenance.offset_basis!=='sanitized_utf16'
      ||(!object(raw.provenance.transformation)||Object.keys(raw.provenance.transformation).sort().join(',')!=='kind,original_end,original_start,sanitized_end,sanitized_start'||!['identity','redacted_coarse'].includes(raw.provenance.transformation.kind)||['original_start','original_end','sanitized_start','sanitized_end'].some(key=>!Number.isSafeInteger(raw.provenance.transformation[key])||raw.provenance.transformation[key]<0)||raw.provenance.transformation.original_start!==0||raw.provenance.transformation.sanitized_start!==0||raw.provenance.transformation.sanitized_end!==raw.provenance.total_chars||raw.provenance.transformation.kind==='identity'&&raw.provenance.transformation.original_end!==raw.provenance.total_chars)
      ||Object.entries(raw.provenance).filter(([key])=>key!=='transformation').some(([key,value])=>['chunk_start','chunk_end','total_chars'].includes(key)?!Number.isSafeInteger(value)||value<0:typeof value!=='string')||!['unknown','declared_message_timestamp'].includes(raw.provenance.date_basis??'unknown')||!(raw.created_at===null||typeof raw.created_at==='string'&&Number.isFinite(Date.parse(raw.created_at)))||!/^[a-f0-9]{64}$/.test(raw.id)||raw.title.length>1024||JSON.stringify(raw.provenance).length>8192||hasHiddenTraceMarker(JSON.stringify(raw.provenance))||redactHistoryText(JSON.stringify(raw.provenance))!==JSON.stringify(raw.provenance)||redactHistoryText(raw.title)!==raw.title||hasHiddenTraceMarker(raw.title)
      ||redactHistoryText(raw.body)!==raw.body||hasHiddenTraceMarker(raw.body))throw invalid();
    const revision=hashCanonicalJson(raw);
    return {recordId:raw.id,evidenceKind,snapshotHash:revision,currentNode:null,diagnostics:[],raw,
      nodes:[{nodeId:raw.id,messageId:null,parentId:null,children:[],role:'artifact',pathState:'unknown',
        parts:[{type:'text',text:raw.body}],assets:[],text:raw.body,createdAt:normalizeTimestamp(raw.created_at),
        sourceRevision:revision,sourceDetails:{artifactKind:raw.artifact_kind,sourceSha256:raw.provenance.source_sha256,
          locator:raw.provenance.locator??null,sanitizedStart:raw.provenance.chunk_start,sanitizedEnd:raw.provenance.chunk_end,totalChars:raw.provenance.total_chars,offsetBasis:raw.provenance.offset_basis,transformation:raw.provenance.transformation,...classifyArchiveSource({locator:raw.provenance.locator,kind:raw.artifact_kind,text:raw.body}),dateBasis:raw.provenance.date_basis??'unknown',attribution:'source_artifact'}}]};
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
      createdAt: normalizeTimestamp(turn.create_time), sourceDetails,
      sourceRevision: hashCanonicalJson({ turn, archived: raw.archived }) };
  });
  for (const node of nodes) {
    if (node.parentId && !seen.has(node.parentId)) diagnostics.push({ code: 'previous_turn_not_in_export', nodeId: node.nodeId });
  }
  return { recordId: raw.id, evidenceKind, snapshotHash, currentNode: null, diagnostics, nodes, raw };
}
