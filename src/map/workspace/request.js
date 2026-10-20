import { VIEW_LIMITS } from './projection.js';
/** Fixed read-only operations. No arbitrary URL, enqueue or drain is admitted. */
export const OPERATIONS = Object.freeze({
  catalog: '/map/catalog', artifact: '/map/artifact', search: '/search', detail: '/analysis/semantic-detail', find: '/analysis/semantic-find',
  trace: '/analysis/semantic-trace', explain: '/analysis/semantic-explain',
  context: '/analysis/context-pack', risk: '/analysis/risk-explain', delta: '/analysis/risk-delta',
  enrichment: '/analysis/semantic-enrichment', runtime: '/analysis/runtime-evidence',
  families: '/analysis/runtime-families', compare: '/analysis/runtime-compare',
  claims: '/analysis/runtime-claims'
});
export async function readBoundedJson(response, limit = VIEW_LIMITS.bytes) {
  if (!response.ok) throw new Error(`Request failed (${response.status}); previous view retained.`);
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new RangeError('Response exceeds the 2 MiB view admission; narrow the query.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const joined = new Uint8Array(bytes); let at = 0;
  for (const chunk of chunks) { joined.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
}
const generationKey = value => value && typeof value === 'object' ? JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]])) : JSON.stringify(value);
/** Canonical records inherit the pinned envelope; artifact wrappers pin their own generation. */
export function semanticDetailInput(node, projection, repoRoot) {
  const ref = node?.detail?.ref ?? node?.ref;
  const generation = node?.detail?.generation ?? projection?.generation;
  if (!ref || !/^(sy1|sa1):[a-f0-9]{64}$/.test(ref.partitionId)
    || !Number.isSafeInteger(ref.localId) || ref.localId < 0
    || !generation || typeof generation.baseBuildId !== 'string' || !generation.baseBuildId.length
    || generation.semanticRevision !== 0 || Object.keys(generation).length !== 2
    || typeof repoRoot !== 'string' || !repoRoot.length) return null;
  return { repoRoot, generation, refs: [ref], include: ['operands', 'names', 'ownership'],
    limits: { records: 128, rows: 512, bytes: 65536, workMs: 250 } };
}
export function createRequestController({ fetchFn = globalThis.fetch } = {}) {
  let controller = null, serial = 0;
  return {
    cancel() { serial++; controller?.abort(); controller = null; },
    async request(operation, input, { token = '', expectedGeneration = null } = {}) {
      if (!Object.hasOwn(OPERATIONS, operation)) throw new Error('Unsupported read-only operation.');
      if (operation === 'enrichment' && input.action && input.action !== 'plan') throw new Error('The viewer only reads enrichment plans; execution is not supported.');
      controller?.abort(); controller = new AbortController(); const requestId = ++serial;
      const request = operation === 'enrichment' ? { ...input, action: 'plan' } : input;
      const result = await readBoundedJson(await fetchFn(OPERATIONS[operation], { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(request) }));
      if (requestId !== serial) throw Object.assign(new Error('Superseded request.'), { name: 'AbortError' });
      const generation = result?.result?.generation ?? result?.generation;
      if (expectedGeneration && generationKey(generation) !== generationKey(expectedGeneration)) throw new Error('Generation mismatch; previous view retained.');
      return result;
    }
  };
}
