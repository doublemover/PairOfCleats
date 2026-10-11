import { canonicalSemanticJson } from './identity.js';
import { collectCompilerCrossFileFlow } from './compiler-cross-file-flow.js';
import { throwIfAborted } from '../../shared/abort.js';

const key = canonicalSemanticJson;
const MAX_EDGES = 4096;
const MAX_TARGETS = 32;
const MAX_ALIAS_DEPTH = 8;
const DECLARATIONS = new Set(['declaration', 'externalDeclaration']);

/** Validated provider candidates and directional declaration aliases can reach
 * retained source summaries. Neither an alias nor a provider target proves runtime
 * dispatch, and external declarations without source summaries stay unknown. */
export const joinProviderCallSummaries = async ({ group, output, store, state, policy, signal }) => {
  const known = new Set(group.flowDocuments.flatMap(doc => doc.summaries.map(summary => summary.declaration).filter(Boolean).map(key)));
  const partitions = [...new Map([...output.partitions, ...group.flowDocuments.map(doc => doc.bindingPartition).filter(Boolean)]
    .map(partition => [partition.partitionId, partition])).values()];
  const providerPartitions = new Set(output.partitions.map(partition => partition.partitionId));
  const pending = [], aliasEdges = [], refs = new Map();
  let remaining = MAX_EDGES, truncated = false;
  outer: for (const partition of partitions) {
    for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges', { signal })) {
      throwIfAborted(signal);
      if (--remaining < 0) { truncated = true; break outer; }
      if (providerPartitions.has(partition.partitionId) && edge.callSite && ['callTarget', 'constructTarget'].includes(edge.kind)) pending.push(edge);
      // Value/heap aliases are not declaration binding authority. Only explicit,
      // context-qualified exact declaration aliases may bridge external targets.
      if (edge.kind === 'aliases' && edge.certainty === 'exact-static' && edge.evidence && edge.contextKey === partition.contextHash) {
        aliasEdges.push(edge);
        for (const ref of [edge.from, edge.to, edge.evidence]) refs.set(key(ref), ref);
      }
    }
  }
  const records = new Map(), values = [...refs.values()];
  for (let offset = 0; offset < values.length; offset += 128) {
    throwIfAborted(signal);
    const batch = values.slice(offset, offset + 128);
    const rows = await store.getRecords(batch, [], { signal });
    rows.forEach((row, index) => { if (row) records.set(key(batch[index]), row); });
  }
  const aliases = new Map();
  for (const edge of aliasEdges) {
    if (!DECLARATIONS.has(records.get(key(edge.from))?.kind) || !DECLARATIONS.has(records.get(key(edge.to))?.kind)
      || records.get(key(edge.evidence))?.kind !== 'evidence') continue;
    const from = key(edge.from);
    if (!aliases.has(from)) aliases.set(from, []);
    aliases.get(from).push(edge.to);
  }
  const bySite = new Map();
  let work = 32768;
  for (const edge of pending) {
    throwIfAborted(signal);
    const site = key({ site: edge.callSite, kind: edge.kind });
    if (!bySite.has(site)) bySite.set(site, new Map());
    const targets = bySite.get(site), queue = [{ ref: edge.to, depth: 0 }], seen = new Set();
    for (let offset = 0; offset < queue.length; offset += 1) {
      if (--work < 0) { truncated = true; break; }
      const { ref, depth } = queue[offset], id = key(ref);
      if (seen.has(id)) continue;
      seen.add(id);
      if (known.has(id)) {
        if (targets.size < MAX_TARGETS || targets.has(id)) targets.set(id, ref);
        else truncated = true;
      }
      const next = aliases.get(id) || [];
      if (depth >= MAX_ALIAS_DEPTH) { if (next.length) truncated = true; continue; }
      for (const candidate of next) {
        if (queue.length >= 256) { truncated = true; break; }
        queue.push({ ref: candidate, depth: depth + 1 });
      }
    }
    if (work < 0) break;
  }
  let changed = false;
  const flowDocuments = group.flowDocuments.map(doc => ({ ...doc, calls: doc.calls.map(call => {
    const refs = bySite.get(key({ site: call.occurrence, kind: call.invocationKind === 'construct' ? 'constructTarget' : 'callTarget' }));
    if (!refs?.size) return call;
    const targets = [...new Map([...call.targets, ...refs.values()].map(ref => [key(ref), ref])).values()];
    changed = true;
    const reason = truncated || targets.length > MAX_TARGETS ? 'provider_call_join_budget' : 'provider_call_target_candidates';
    return { ...call, targets: targets.slice(0, MAX_TARGETS), incompleteTargets: true, reason: [...new Set([call.reason, reason].filter(Boolean))].join(';') };
  }) }));
  if (!changed) return [];
  return collectCompilerCrossFileFlow({ group: { ...group, flowDocuments, providerInputHashes: partitions.map(row => row.canonicalHash).sort() }, state, policy, signal });
};
