import { canonicalSemanticJson, semanticHash, createAnalysisPartitionId } from '../semantic/identity.js';
import { writeSemanticAnalysis } from '../semantic/analysis-write.js';
import { validateSemanticRecord } from '../../contracts/validators/semantic.js';
import { providerProfileCacheIdentity, verifyProviderProfileReceipt } from './provider-profile.js';
import { throwIfAborted } from '../../shared/abort.js';
import { combineSemanticProviderOutputs } from './result-dispatch.js';
import path from 'node:path';

const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_PROVIDER_ROWS' });
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);

/** Allocate targets on the host before execution. Producers can add derived
 * facts only to these partitions and cannot choose a write root or syntax ID. */
export const createCanonicalProviderRequest = ({ profile, requestId, generation, sources, questions = [] }) => {
  const profileHash = providerProfileCacheIdentity(profile, { providerId: profile?.providerId, adapterVersion: profile?.adapterVersion });
  if (!profileHash || typeof requestId !== 'string' || !requestId || requestId.length > 256
    || !(sources instanceof Map) || !sources.size || sources.size > 256 || !Array.isArray(questions) || questions.length > 256) throw fail('Complete profile and bounded host source targets are required.');
  const sourceUnits = [...sources.values()].map(item => {
    if (!same(item.facts.storage.generation, generation)) throw fail('Mixed provider request generations.');
    if (!profile.sources.some(source => source.hash === item.source.byteHash
      && path.resolve(source.path) === path.resolve(profile.project.root, item.source.path))) throw fail('Provider target is outside the observed source profile.');
    return { sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash,
      syntaxPartitionId: item.syntax.partitionId, syntaxHash: item.syntax.canonicalHash };
  }).sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId));
  if (new Set(sourceUnits.map(value => value.sourceUnitId)).size !== sourceUnits.length) throw fail('Duplicate host source identity.');
  const contextHash = semanticHash('tooling.provider-row-context.v1', { profileHash, generation, sourceUnits });
  const targets = sourceUnits.map(source => ({ ...source, partitionId: createAnalysisPartitionId({
    pass: { name: 'external-provider-rows', version: '1' }, inputPartitionHashes: [source.syntaxHash],
    compilerContext: contextHash, dependencySummaryHashes: [profileHash], analysisPolicy: { requestId, sourceUnitId: source.sourceUnitId }
  }) }));
  return { schemaVersion: 1, requestId, resultKind: 'canonical-rows-v1', profileHash,
    sourceSnapshotHash: semanticHash('tooling.provider-source-snapshot.v1', sourceUnits),
    generation: structuredClone(generation), contextHash, targets, questions: structuredClone(questions) };
};

/** One host-owned materializer shared by offline and process transports. It
 * charges the generation's existing disk account and selects no descriptors. */
export const createCanonicalProviderRowWriter = ({ request, profile, sources, state, policy,
  maxRows = 16384, maxBytes = 8 * 1048576, signal = null }) => {
  const expected = createCanonicalProviderRequest({ profile, requestId: request.requestId,
    generation: request.generation, sources, questions: request.questions });
  if (!same(request, expected) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 16384
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1048576) throw fail('Provider request or writer bounds changed.');
  const pinned = structuredClone(request), items = new Map([...sources.values()].map(item => [item.source.sourceUnitId, item]));
  let completed = false;
  return async report => {
    throwIfAborted(signal);
    if (completed || report?.schemaVersion !== 1 || report.kind !== 'canonical-rows-v1' || !Array.isArray(report.batches)) throw fail('Invalid or repeated completed row report.');
    completed = true;
    await verifyProviderProfileReceipt(profile, { signal });
    const groups = new Map();
    let retainedRows = 0, retainedBytes = 0;
    for (const batch of report.batches) {
      if (!batch || !items.has(batch.sourceUnitId) || !Array.isArray(batch.rows)) throw fail('Provider emitted an unknown source target.');
      const rows = groups.get(batch.sourceUnitId) || [];
      for (const entry of batch.rows) {
        if (++retainedRows > maxRows) throw fail('Provider semantic row budget exhausted.');
        if (!entry || !['node', 'operand', 'edge', 'coverage', 'lookup'].includes(entry.family)
          || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'row')) throw fail('Provider cannot emit syntax/source/ownership/frontier records.');
        if (entry.family === 'coverage' && entry.row?.state === 'complete') throw fail('External rows cannot claim unqualified complete source coverage.');
        if (entry.family === 'node' && ['scope', 'declaration', 'occurrence', 'statement', 'expression', 'literal'].includes(entry.row?.kind)) throw fail('Provider syntax must be admitted by the parser stage.');
        const validation = validateSemanticRecord(entry.family, entry.row, { structuralSlots: [] });
        if (!validation.ok) throw fail(`Invalid provider ${entry.family} row: ${JSON.stringify(validation.errors)}`);
        const canonical = canonicalSemanticJson(entry);
        retainedBytes += Buffer.byteLength(canonical);
        if (retainedBytes > maxBytes) throw fail('Provider retained row bytes exhausted.');
        rows.push(JSON.parse(canonical));
      }
      groups.set(batch.sourceUnitId, rows);
    }
    const context = { contextKey: pinned.contextHash, providerId: profile.providerId, providerVersion: profile.adapterVersion,
      compilerVersion: profile.tool.observedVersion, configHash: profile.project.configHash,
      moduleResolutionHash: profile.project.moduleResolutionHash, vfsMappingHash: profile.project.vfsMappingHash,
      sourceUnits: pinned.targets.map(target => ({ sourceUnitId: target.sourceUnitId, byteHash: target.byteHash })) };
    const partitions = [];
    for (const target of pinned.targets) {
      const rows = groups.get(target.sourceUnitId);
      if (!rows?.length) continue;
      throwIfAborted(signal);
      const item = items.get(target.sourceUnitId), current = state.semanticFactsByFile.get(item.file);
      if (!current || current.sourceHash !== target.byteHash || current.syntaxPartitionId !== target.syntaxPartitionId
        || current.partitions.find(partition => partition.partitionId === target.syntaxPartitionId)?.canonicalHash !== target.syntaxHash
        || !same(current.storage, item.facts.storage) || !same(current.storage.generation, pinned.generation)) throw fail('Provider target source changed before materialization.');
      partitions.push(await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source,
        sourceBytes: item.bytes, partitionId: target.partitionId, contextHash: context.contextKey,
        producerHash: pinned.profileHash, policyHash: semanticHash('tooling.provider-row-policy.v1', { version: 1 }),
        structuralSlots: [], diskAccount: state.semanticDiskAccount, signal }));
    }
    throwIfAborted(signal);
    return combineSemanticProviderOutputs([{ schemaVersion: 1, contexts: partitions.length ? [context] : [],
      partitions, coverageRef: null, diagnosticsRef: null }]);
  };
};
