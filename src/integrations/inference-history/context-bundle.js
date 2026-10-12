import { HISTORY_AGENT_VERSION } from './agent-contract.js';
/** Pure merge of already-authorized context packets, never a new archive read. */
export function mergeHistoryContexts(packets, { maxMessages = 20 } = {}) {
  if (!Array.isArray(packets) || packets.length > 10 || !Number.isSafeInteger(maxMessages)
    || maxMessages < 1 || maxMessages > 100) throw new TypeError('Invalid bounded context merge.');
  const generations = new Set(), messages = new Map(), order = [];
  for (const packet of packets) {
    if (!packet?.ok || packet.version !== HISTORY_AGENT_VERSION || !['context','timeline'].includes(packet.command)
      || !Array.isArray(packet.evidence) || !packet.index?.generationRef) throw new TypeError('Versioned generation-pinned context packets required.');
    generations.add(packet.index.generationRef);
    for (const row of packet.evidence) {
      const key = JSON.stringify([row.snapshotRef,row.sourceRef ?? row.messageId]);
      if (!row.snapshotRef || (!row.sourceRef && !row.messageId)) throw new TypeError('Exact message identity required.');
      const existing = messages.get(key);
      if (!existing) { messages.set(key,structuredClone(row)); order.push(key); }
      else {
        if (existing.role !== row.role || existing.createdAt?.utc !== row.createdAt?.utc
          || (!String(existing.text ?? '').startsWith(row.text ?? '') && !String(row.text ?? '').startsWith(existing.text ?? ''))) {
          throw new TypeError('Overlapping message evidence conflicts.');
        }
        const anchor = existing.anchor || row.anchor;
        if ((row.text?.length ?? 0) > (existing.text?.length ?? 0)) messages.set(key,structuredClone(row));
        messages.get(key).anchor = anchor;
      }
    }
  }
  if (generations.size > 1) throw new TypeError('Cannot merge different index generations.');
  const groups = new Map();
  for (const key of order) {
    const row = messages.get(key);
    if (!groups.has(row.snapshotRef)) groups.set(row.snapshotRef,[]);
    groups.get(row.snapshotRef).push(row);
  }
  for (const rows of groups.values()) rows.sort((left,right) =>
    (left.createdAt?.utc === null) - (right.createdAt?.utc === null)
    || (left.createdAt?.utc ?? '').localeCompare(right.createdAt?.utc ?? ''));
  const all = [...groups.values()].flat();
  return { version:HISTORY_AGENT_VERSION, generationRef:[...generations][0] ?? null,
    evidence:all.slice(0,maxMessages), totalUniqueMessages:all.length,
    omittedMessages:Math.max(0,all.length-maxMessages), truncated:all.length>maxMessages,
    caveat:'Merged returned spans only; no conversation completeness or accepted preference is inferred.' };
}
