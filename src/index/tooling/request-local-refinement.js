import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { offsetToLspPosition } from '../semantic/lsp-locations.js';
import { providerProfileCacheIdentity, verifyProviderProfileReceipt } from './provider-profile.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { isRepoTrusted } from '../../shared/config-authority.js';
import { throwIfAborted, isAbortError } from '../../shared/abort.js';
import { createLspObservationCollector } from '../../integrations/tooling/providers/lsp/structured-observations.js';

const grants = new WeakMap();
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_REQUEST_LOCAL' });
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);
const requestIdentity = request => semanticHash('semantic.request-local-binding.v1', request);
const validateRequest = request => {
  if (!request || request.schemaVersion !== 1 || request.action !== 'ephemeral' || request.factFamily !== 'binding'
    || typeof request.repoRoot !== 'string' || !request.generation || !request.ref || request.publish !== undefined) throw fail('Explicit ephemeral binding request required; publication uses the separate durable API.');
  const limits = request.limits;
  if (!limits || Object.keys(limits).length !== 4) throw fail('Explicit request-local budgets are required.');
  for (const [key, maximum] of [['maxMs', 30000], ['maxFacts', 256], ['maxBytes', 65536], ['maxSourceBytes', 512 * 1024]]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > maximum) throw fail('Invalid request-local ' + key + ' allowance.');
  }
  if (limits.maxBytes < 4096) throw fail('Request-local response allowance must include its qualified envelope.');
  canonicalSemanticJson(request);
};

/** Called by an explicit opt-in host action, never by ordinary detail/trace or
 * context assembly. The token is scoped to one exact question/profile and does
 * not authorize publication, task enqueue or a general provider tooling pass. */
export const createRequestLocalRefinementGrant = ({ request, profile }) => {
  validateRequest(request);
  const profileHash = providerProfileCacheIdentity(profile, { providerId: profile?.providerId,
    adapterVersion: profile?.adapterVersion, repoRoot: request.repoRoot });
  if (!profileHash || !isRepoTrusted(request.repoRoot)) throw fail('Request-local execution requires an observed profile and exact launching repository trust.');
  const token = Object.freeze({ scope: 'request-local-semantic-refinement' });
  grants.set(token, { requestHash: requestIdentity(request), profileHash });
  return token;
};

/** One source-pinned definition question using a qualified bounded provider.
 * This module imports no writer, task/control store, publisher or index mutator. */
export const runRequestLocalBindingRefinement = async ({ request, grant, profile, provider,
  store, sourceWitnesses = new Map(), signal = null }) => {
  validateRequest(request);
  const pinned = JSON.parse(canonicalSemanticJson(request)), startedAt = performance.now();
  const authority = grants.get(grant);
  const result = { schemaVersion: 1, kind: 'request-local-semantic-overlay', ephemeral: true,
    generation: pinned.generation, requestId: requestIdentity(pinned), source: null,
    status: 'unsupported', reason: null, observation: null, publishedGeneration: null };
  const profileHash = providerProfileCacheIdentity(profile, { providerId: profile?.providerId,
    adapterVersion: profile?.adapterVersion, repoRoot: pinned.repoRoot });
  const authorized = () => authority && authority.requestHash === requestIdentity(pinned)
    && authority.profileHash === profileHash && isRepoTrusted(pinned.repoRoot);
  if (!authorized()) return { ...result, status: 'denied', reason: 'execution_grant_unavailable' };
  if (!same(store.generation, pinned.generation) || path.relative(path.resolve(store.repoRoot), path.resolve(pinned.repoRoot)) !== '') throw fail('Request-local overlay generation/root differs from its pinned store.');
  if (!provider || provider.qualification?.state !== 'qualified' || provider.qualification.profileHash !== profileHash
    || !provider.qualification.methods?.includes('textDocument/definition') || typeof provider.request !== 'function') {
    return { ...result, reason: 'qualified_binding_provider_unavailable' };
  }
  const deadline = AbortSignal.timeout(pinned.limits.maxMs);
  const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    throwIfAborted(boundedSignal);
    await verifyProviderProfileReceipt(profile, { signal: boundedSignal });
    const [occurrence] = await store.getRecords([pinned.ref], ['span', 'data'], { signal: boundedSignal });
    if (occurrence?.kind !== 'occurrence' || !occurrence.span) return { ...result, reason: 'source_occurrence_required' };
    let source;
    for await (const manifest of store.iterateRows(pinned.ref.partitionId, 'semantic_sources', { signal: boundedSignal })) {
      if (source) throw fail('Multiple request-local source manifests.');
      source = manifest;
    }
    if (!source || source.encoding !== 'utf8' || source.mapping) return { ...result, reason: 'source_mapping_not_supported' };
    await store.verifySource(source, { signal: boundedSignal });
    const filename = path.resolve(pinned.repoRoot, source.path);
    if (!profile.sources.some(value => path.relative(path.resolve(value.path), filename) === '' && value.hash === source.byteHash)) return { ...result, status: 'stale', reason: 'profile_source_mismatch' };
    const { buffer } = await readVerifiedContainedFile(pinned.repoRoot, filename, {
      expectedHash: source.byteHash, maxBytes: pinned.limits.maxSourceBytes, signal: boundedSignal
    });
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    const uri = pathToFileURL(filename).href, snapshots = new Map([[uri, { source: structuredClone(source), text }]]);
    let sourceBytes = buffer.length;
    if (!(sourceWitnesses instanceof Map) || sourceWitnesses.size > 20) throw fail('Request-local target witnesses exceed their source bound.');
    for (const [targetUri, witness] of sourceWitnesses) {
      if (targetUri === uri) continue;
      if (!witness?.source || typeof witness.text !== 'string' || !same(witness.generation, pinned.generation)
        || createHash('sha256').update(witness.text).digest('hex') !== witness.source.byteHash) throw fail('Request-local target witness source/generation mismatch.');
      sourceBytes += Buffer.byteLength(witness.text);
      if (sourceBytes > pinned.limits.maxSourceBytes) throw fail('Request-local retained source budget exhausted.');
      let canonical;
      for await (const manifest of store.iterateRows(witness.partitionId, 'semantic_sources', { signal: boundedSignal })) {
        if (canonical) throw fail('Multiple request-local target source manifests.');
        canonical = manifest;
      }
      if (!canonical || !same(canonical, witness.source)) throw fail('Request-local target witness is outside the pinned partition inventory.');
      await store.verifySource(witness.source, { signal: boundedSignal });
      snapshots.set(targetUri, { source: structuredClone(witness.source), text: witness.text });
    }
    result.source = { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, path: source.path,
      recordRef: pinned.ref, span: occurrence.span };
    const collector = createLspObservationCollector({ identity: { sessionId: provider.sessionId || profileHash,
      profileId: profileHash, contextHash: semanticHash('semantic.ephemeral-context.v1', { profileHash, generation: pinned.generation }),
      sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, generation: pinned.generation, uri },
    consumers: ['navigation'], capabilities: { definition: true }, requestBudgets: { definition: { tryReserve: () => true } },
    maxRequests: 1, maxFacts: pinned.limits.maxFacts, maxBytes: pinned.limits.maxBytes,
    maxMs: pinned.limits.maxMs, signal: boundedSignal, projectReady: provider.projectReady === 'ready' ? 'ready' : 'unknown',
    isCurrent: () => authorized() && same(store.generation, pinned.generation),
    sourceForUri: targetUri => snapshots.get(targetUri),
    request: (method, params, options) => provider.request(method, params, options) });
    const position = offsetToLspPosition(source, text, occurrence.span[0], provider.positionEncoding || 'utf-16');
    const observation = await collector.acquire({ requestClass: 'definition', params: { textDocument: { uri }, position },
      positionEncoding: provider.positionEncoding || 'utf-16' });
    throwIfAborted(boundedSignal);
    if (!authorized()) return { ...result, status: 'denied', reason: 'execution_grant_revoked' };
    await verifyProviderProfileReceipt(profile, { signal: boundedSignal });
    // Live bytes must still match after execution. No late result can join a
    // changed source, even when the provider retained the original open text.
    await readVerifiedContainedFile(pinned.repoRoot, filename, { expectedHash: source.byteHash,
      maxBytes: pinned.limits.maxSourceBytes, signal: boundedSignal });
    const complete = observation.state === 'complete';
    result.status = complete ? 'complete' : observation.state === 'failed' ? 'failed' : 'partial';
    result.reason = observation.reason;
    result.observation = observation;
    result.elapsedMs = Math.max(0, performance.now() - startedAt);
    if (Buffer.byteLength(canonicalSemanticJson(result)) > pinned.limits.maxBytes) return { ...result,
      status: 'partial', reason: 'response_byte_budget', observation: null };
    return result;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (deadline.aborted || isAbortError(error)) return { ...result, status: 'partial', reason: 'deadline_or_cancelled', observation: null };
    if (['ERR_FILE_CHANGED', 'ERR_SEMANTIC_SOURCE_MISMATCH', 'ENOENT'].includes(error.code)) return { ...result, status: 'stale', reason: 'live_source_mismatch', observation: null };
    throw error;
  }
};
