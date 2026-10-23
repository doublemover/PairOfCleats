import { VIEW_LIMITS } from './projection.js';
const failures = new WeakMap();
/** Bounded passive diagnostics; reporting cannot replace the original throw. */
export function captureWorkspaceFailure(primary) {
  const object = primary !== null && (typeof primary === 'object' || typeof primary === 'function');
  if (object && failures.has(primary)) return failures.get(primary);
  const inspectionErrors = [], fields = {};
  if (object) for (const key of ['message', 'name']) {
    try { const descriptor = Object.getOwnPropertyDescriptor(primary, key); if (descriptor && Object.hasOwn(descriptor, 'value')) fields[key] = descriptor.value; }
    catch (error) { inspectionErrors.push(error); }
  }
  const message = typeof fields.message === 'string' ? fields.message.slice(0, 1024)
    : typeof primary === 'string' ? primary.slice(0, 1024) : 'Workspace action failed; previous admitted evidence retained.';
  const captured = Object.freeze({ primary, message, name: typeof fields.name === 'string' ? fields.name : 'Error', inspectionErrors: Object.freeze(inspectionErrors) });
  if (object) failures.set(primary, captured);
  return captured;
}
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
const ownValue = (value, key) => {
  if (value === null || typeof value !== 'object') return { present: false };
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false };
  if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Semantic hydration requires decoded source fields.');
  return { present: true, value: descriptor.value };
};
const exactRecord = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
/** Canonical records inherit the pinned envelope; artifact wrappers pin their own generation. */
export function semanticDetailInput(node, projection, repoRoot) {
  try {
    const detail = ownValue(node, 'detail').value;
    const wrappedRef = ownValue(detail, 'ref'), wrappedGeneration = ownValue(detail, 'generation');
    const originalRef = wrappedRef.present ? wrappedRef.value : ownValue(node, 'ref').value;
    const originalGeneration = wrappedGeneration.present ? wrappedGeneration.value : ownValue(projection, 'generation').value;
    if (!exactRecord(originalRef, ['partitionId', 'localId']) || !exactRecord(originalGeneration, ['baseBuildId', 'semanticRevision'])) return null;
    const partitionId = ownValue(originalRef, 'partitionId').value, localId = ownValue(originalRef, 'localId').value;
    const baseBuildId = ownValue(originalGeneration, 'baseBuildId').value, semanticRevision = ownValue(originalGeneration, 'semanticRevision').value;
    if (typeof partitionId !== 'string' || !/^(sy1|sa1):[a-f0-9]{64}$/.test(partitionId)
      || !Number.isSafeInteger(localId) || localId < 0 || typeof baseBuildId !== 'string' || !baseBuildId.length
      || semanticRevision !== 0 || typeof repoRoot !== 'string' || !repoRoot.length) return null;
    return { repoRoot, generation: { baseBuildId, semanticRevision }, refs: [{ partitionId, localId }], include: ['operands', 'names', 'ownership'],
      limits: { records: 128, rows: 512, bytes: 65536, workMs: 250 } };
  } catch { return null; }
}
export function createRequestController({ fetchFn = globalThis.fetch } = {}) {
  let controller = null, serial = 0;
  return {
    cancel() { serial++; controller?.abort(); controller = null; },
    async request(operation, input, { token = '', expectedGeneration = null } = {}) {
      if (!Object.hasOwn(OPERATIONS, operation)) throw new Error('Unsupported read-only operation.');
      if (operation === 'enrichment' && input.action && input.action !== 'plan') throw new Error('The viewer only reads enrichment plans; execution is not supported.');
      const hasExpectedGeneration = expectedGeneration !== null && expectedGeneration !== undefined;
      const originalGenerationKey = hasExpectedGeneration ? generationKey(expectedGeneration) : null;
      controller?.abort(); controller = new AbortController(); const requestId = ++serial;
      const request = operation === 'enrichment' ? { ...input, action: 'plan' } : input;
      const result = await readBoundedJson(await fetchFn(OPERATIONS[operation], { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(request) }));
      if (requestId !== serial) throw Object.assign(new Error('Superseded request.'), { name: 'AbortError' });
      const generation = result?.result?.generation ?? result?.generation;
      if (hasExpectedGeneration && generationKey(generation) !== originalGenerationKey) throw new Error('Generation mismatch; previous view retained.');
      return result;
    }
  };
}
