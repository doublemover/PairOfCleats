import { canonicalSemanticJson } from './identity.js';
import { collectCompilerCrossFileFlow } from './compiler-cross-file-flow.js';
import { throwIfAborted } from '../../shared/abort.js';
import { createProviderAliasClosureResolver } from './provider-alias-closure.js';

const key = canonicalSemanticJson;
const MAX_EDGES = 4096;
const MAX_TARGETS = 32;
const DECLARATIONS = new Set(['declaration', 'externalDeclaration']);

/** Validated provider candidates and directional declaration aliases can reach
 * retained source summaries. Neither an alias nor a provider target proves runtime
 * dispatch, and external declarations without source summaries stay unknown. */
export const joinProviderCallSummaries = async ({ group, output, store, state, policy, signal }) => {
  const known = new Set(group.flowDocuments.flatMap(doc => doc.summaries.map(summary => summary.declaration).filter(Boolean).map(key)));
  const partitions = [...new Map([...output.partitions, ...group.flowDocuments.map(doc => doc.bindingPartition).filter(Boolean)]
    .map(partition => [partition.partitionId, partition])).values()];
  const providerPartitions = new Set(output.partitions.map(partition => partition.partitionId));
  const partitionById = new Map(partitions.map(partition => [partition.partitionId, partition]));
  const callSources = new Map(group.flowDocuments.flatMap(doc => doc.calls.map(call => [key(call.occurrence), doc.item.source.sourceUnitId])));
  const pending = [], aliasEdges = [], refs = new Map();
  let remaining = MAX_EDGES, truncated = false, unqualified = false;
  outer: for (const partition of partitions) {
    for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges', { signal })) {
      throwIfAborted(signal);
      if (--remaining < 0) { truncated = true; break outer; }
      if (providerPartitions.has(partition.partitionId) && edge.callSite && ['callTarget', 'constructTarget'].includes(edge.kind)) {
        if (edge.contextKey !== partition.contextHash || key(edge.from) !== key(edge.callSite)
          || callSources.get(key(edge.callSite)) !== partition.sourceUnitId || !edge.evidence) unqualified = true;
        else {
          pending.push({ edge, partition });
          refs.set(key(edge.evidence), edge.evidence); refs.set(key(edge.to), edge.to);
        }
      }
      // Value/heap aliases are not declaration binding authority. Only explicit,
      // context-qualified exact declaration aliases may bridge external targets.
      if (edge.kind === 'aliases' && edge.certainty === 'exact-static' && edge.evidence && edge.contextKey === partition.contextHash) {
        aliasEdges.push({ edge, partition });
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
  const qualifiedEvidence = (edge, partition) => {
    const evidence = records.get(key(edge.evidence)), owner = partitionById.get(edge.evidence.partitionId);
    return evidence?.kind === 'evidence' && owner?.contextHash === edge.contextKey
      && owner.sourceUnitId === partition.sourceUnitId && evidence.data.sourceRef === partition.sourceUnitId;
  };
  const aliases = new Map();
  for (const { edge, partition } of aliasEdges) {
    const endpoints = [records.get(key(edge.from)), records.get(key(edge.to))];
    if (!DECLARATIONS.has(records.get(key(edge.from))?.kind) || !DECLARATIONS.has(records.get(key(edge.to))?.kind)
      || !qualifiedEvidence(edge, partition) || endpoints.some(record => record.kind === 'externalDeclaration'
        && record.data.contextKey !== edge.contextKey)) { unqualified = true; continue; }
    const from = key(edge.from);
    if (!aliases.has(from)) aliases.set(from, []);
    aliases.get(from).push(edge.to);
  }
  const bySite = new Map();
  const closures = createProviderAliasClosureResolver({ aliases, known, signal });
  for (const { edge, partition } of pending) {
    throwIfAborted(signal);
    if (!qualifiedEvidence(edge, partition)) { unqualified = true; continue; }
    const external = records.get(key(edge.to));
    if (external?.kind === 'externalDeclaration' && external.data.contextKey !== edge.contextKey) { unqualified = true; continue; }
    const site = key({ site: edge.callSite, kind: edge.kind });
    if (!bySite.has(site)) bySite.set(site, new Map());
    const targets = bySite.get(site), closure = closures.resolve(edge.to);
    if (closure.truncated) truncated = true;
    for (const ref of closure.targets) {
      const id = key(ref);
      if (targets.size < MAX_TARGETS || targets.has(id)) targets.set(id, ref);
      else truncated = true;
    }
  }
  let changed = false;
  const flowDocuments = group.flowDocuments.map(doc => ({ ...doc, calls: doc.calls.map(call => {
    const refs = bySite.get(key({ site: call.occurrence, kind: call.invocationKind === 'construct' ? 'constructTarget' : 'callTarget' }));
    if (!refs?.size) return call;
    const targets = [...new Map([...call.targets, ...refs.values()].map(ref => [key(ref), ref])).values()];
    changed = true;
    const reason = truncated || targets.length > MAX_TARGETS ? 'provider_call_join_budget' : 'provider_call_target_candidates';
    return { ...call, targets: targets.slice(0, MAX_TARGETS), incompleteTargets: true,
      reason: [...new Set([call.reason, reason, unqualified ? 'provider_call_join_unqualified_evidence' : null].filter(Boolean))].join(';') };
  }) }));
  if (!changed) return [];
  return collectCompilerCrossFileFlow({ group: { ...group, flowDocuments, providerInputHashes: partitions.map(row => row.canonicalHash).sort() }, state, policy, signal });
};
