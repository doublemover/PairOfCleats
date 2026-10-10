import { performance } from 'node:perf_hooks';
import { assertSemanticTask } from '../contracts/validators/semantic-task.js';
import { semanticTaskInputHash } from '../index/semantic/frontier.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';

/** Bounded suggestions only. The explicit enrichment service revalidates targets before enqueue. */
const project = async ({ store, manifest, request, result, signal, maxMs }) => {
  manifest ||= store.getExplainInventory?.();
  const sourceRefs = [], suggestions = [], reasons = [];
  const enrichment = { status: 'unavailable', reasons, suggestions };
  if (manifest?.completedTasks === null) reasons.push('Task completion metadata is unavailable; suggested immutable tasks require an explicit plan status check.');
  if (!manifest || typeof store.iterateRows !== 'function') {
    reasons.push('Pinned source/frontier inventory is unavailable on this store.');
    return { sourceRefs, enrichment };
  }
  if (canonicalSemanticJson(manifest.generation) !== canonicalSemanticJson(request.generation)) {
    throw Object.assign(new Error('Explanation inventory generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  const began = performance.now();
  const expired = () => performance.now() - began >= maxMs;
  const sources = new Map(), byPartition = new Map(manifest.partitions.map(row => [row.partitionId, row]));
  let scanned = 0, truncated = false;
  for (const row of result.records) {
    throwIfAborted(signal);
    if (sourceRefs.length >= 32 || expired()) { truncated = true; break; }
    const partition = byPartition.get(row.ref.partitionId);
    if (!partition) throw new Error('Explanation record partition is outside the pinned inventory.');
    let source = sources.get(partition.sourceUnitId);
    if (!source) {
      const syntax = manifest.partitions.find(entry => entry.sourceUnitId === partition.sourceUnitId && entry.partitionId.startsWith('sy1:'));
      if (!syntax) { reasons.push('Source manifest is unavailable for a retained analysis record.'); continue; }
      for await (const entry of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal, batchRows: 1 })) {
        if (source) throw new Error('Duplicate explanation source manifest.');
        source = entry;
      }
      if (!source || source.sourceUnitId !== partition.sourceUnitId) throw new Error('Explanation source identity mismatch.');
      sources.set(source.sourceUnitId, source);
    }
    sourceRefs.push({ ref: row.ref, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      path: source.path, coordinateUnit: 'utf16' });
  }
  if (!result.frontier.some(row => row.reason === 'analysis_incomplete')) {
    enrichment.status = truncated ? 'partial' : 'not-needed';
    if (truncated) reasons.push('Source pin projection reached its allowance.');
    return { sourceRefs, enrichment };
  }
  const seen = new Set();
  outer: for (const partition of manifest.partitions) {
    if (expired()) { truncated = true; break; }
    if (!partition.members.semantic_frontier?.length) continue;
    for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier', { signal, batchRows: 1 })) {
      throwIfAborted(signal);
      if (++scanned > 256 || expired()) { truncated = true; break outer; }
      assertSemanticTask(task);
      if (task.baseBuildId !== request.generation.baseBuildId) throw new Error('Explanation task belongs to another generation.');
      if (seen.has(task.taskId)) continue;
      seen.add(task.taskId);
      if (!task.sourceUnits.some(id => sources.has(id)) || manifest.completedTasks?.some(row => row.taskId === task.taskId)) continue;
      if (suggestions.length >= 8) { truncated = true; break outer; }
      const pins = task.sourceUnits.filter(id => sources.has(id)).map(id => ({ sourceUnitId: id, sourceHash: sources.get(id).byteHash }));
      const base = { schemaVersion: 1, repoRoot: request.repoRoot, generation: request.generation, taskIds: [task.taskId] };
      suggestions.push({ taskId: task.taskId, generation: request.generation, inputHash: semanticTaskInputHash(task),
        policyHash: task.policyHash, kind: task.kind, reason: task.reason, sourceRefs: pins,
        planRequest: { ...base, action: 'plan' }, enqueueRequest: { ...base, action: 'enqueue' } });
    }
  }
  enrichment.status = truncated ? 'partial' : suggestions.length ? 'available' : 'unavailable';
  reasons.push('Suggestions authorize no execution; explicit enqueue revalidates immutable task inputs and may remain pending.');
  if (suggestions.length) reasons.push('A retained task may cover additional sources beyond this page; sourceRefs cite only hydrated source identities.');
  if (truncated) reasons.push('Source/frontier suggestion scan reached its bounded allowance.');
  if (!suggestions.length) reasons.push('No matching retained pending task was found in the inspected inventory; incomplete analysis is not an executable task.');
  return { sourceRefs, enrichment };
};

export const projectExplainEnrichment = async input => {
  throwIfAborted(input.signal);
  const maxMs=Math.max(0,Math.min(input.maxMs??input.request.limits?.workMs??250,250));
  if(maxMs===0)return {sourceRefs:[],enrichment:{status:'partial',suggestions:[],reasons:['Trace consumed the work allowance; source/frontier projection requires another bounded request.']}};
  const deadline = AbortSignal.timeout(Math.max(1,Math.ceil(maxMs)));
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try { return await project({ ...input, signal, maxMs }); }
  catch (error) {
    throwIfAborted(input.signal);
    if (!deadline.aborted) throw error;
    return { sourceRefs: [], enrichment: { status: 'partial', suggestions: [],
      reasons: ['Source/frontier projection exhausted its work allowance; no task suggestion was inferred.'] } };
  }
};
