import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { createSemanticPartitionSink } from '../build/artifacts/writers/semantic/partition.js';
import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';

/** Interval tree avoids scanning every chunk for every syntax record. */
const createOwnershipLookup = (chunks) => {
  const spans = chunks.filter(c => (c.chunkUid || c.metaV2?.chunkUid) && Number.isSafeInteger(c.start) && Number.isSafeInteger(c.end))
    .map(c => ({ start: c.start, end: c.end, uid: c.chunkUid || c.metaV2.chunkUid }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.uid.localeCompare(b.uid));
  const build = (lo, hi) => {
    if (lo >= hi) return null;
    const mid = (lo + hi) >>> 1;
    const left = build(lo, mid), right = build(mid + 1, hi), item = spans[mid];
    return { item, left, right, maxEnd: Math.max(item.end, left?.maxEnd ?? -1, right?.maxEnd ?? -1) };
  };
  const tree = build(0, spans.length);
  return { spans, find: (span) => {
    const stack = [tree], matches = [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.maxEnd <= span[0]) continue;
      if (node.item.start < span[1] && node.item.end > span[0]) matches.push(node.item);
      stack.push(node.left);
      if (node.item.start < span[1]) stack.push(node.right);
    }
    return matches.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.uid.localeCompare(b.uid));
  } };
};
export const collectSemanticOwnership = async ({ facts, chunks, bytes,
  repositoryNamespace, stagingRoot, diskAccount, policy, signal, scheduleIo }) => {
  const lookup = createOwnershipLookup(chunks);
  const source = facts.source;
  const policyHash = semanticHash('semantic.ownership-policy.v1', { chunks: lookup.spans });
  const partitionId = createAnalysisPartitionId({ pass: { name: 'chunk-ownership', version: '1' },
    inputPartitionHashes: [facts.partition.canonicalHash], compilerContext: null,
    dependencySummaryHashes: [], analysisPolicy: { policyHash } });
  const sink = await createSemanticPartitionSink({ stagingRoot, source, sourceBytes: bytes, partitionId,
    producerHash: semanticHash('semantic.ownership-producer.v1', { version: 1 }), policyHash,
    diskAccount, signal, scheduleIo, batchRows: policy.storage.batchRows, batchBytes: policy.storage.batchBytes });
  const store = createArtifactSemanticStore({ root: stagingRoot, repoRoot: repositoryNamespace,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: { baseBuildId: 'staging', semanticRevision: 0 }, partitions: [facts.partition] });
  let rows = [], byteCount = 0, sequence = 0;
  const flush = async () => {
    if (!rows.length) return;
    await sink.appendBatch({ partitionId, sequence: sequence++, rows, byteCount }); rows = []; byteCount = 0;
  };
  try {
    for await (const row of store.iterateRows(facts.partition.partitionId, 'semantic_records', { signal })) {
      if (!row.span) continue;
      const matches = lookup.find(row.span);
      let primary = false;
      for (const match of matches) {
        const contains = match.start <= row.span[0] && match.end >= row.span[1];
        const entry = { family: 'ownership', row: { recordRef: { partitionId: facts.partition.partitionId, localId: row.id },
          chunkUid: match.uid, role: contains && !primary ? 'primary' : 'overlap' } };
        if (contains) primary = true;
        const size = Buffer.byteLength(canonicalSemanticJson(entry)) + 1;
        if (rows.length && (rows.length >= policy.storage.batchRows || byteCount + size > policy.storage.batchBytes)) await flush();
        rows.push(entry); byteCount += size;
      }
    }
    await flush();
    return { root: facts.root, partition: facts.partition, summary: facts.summary, partitions: [facts.partition, await sink.finalizeSource()] };
  } catch (error) { await sink.abort(); throw error; }
};
