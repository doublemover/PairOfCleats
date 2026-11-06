import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { semanticHash } from '../../index/semantic/identity.js';
import { captureRetrievalAdaptation } from '../../contracts/validators/retrieval-adaptation.js';
import { assertEmbeddingArtifactCompatibility } from '../embedding-artifact-identity.js';
import { admitEmbeddingVector } from '../embedding-output-admission.js';

const owned = new WeakMap(), retired = new WeakMap();
const fail = message => Object.assign(new Error(message), { code: 'ERR_RETRIEVAL_ADAPTATION' });
const hash = (kind, value) => semanticHash('directional-query.' + kind + '.v1', value, { maxBytes: 4 * 1024 * 1024 });
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifactContent = artifact => ({ schemaVersion: artifact.schemaVersion, kind: artifact.kind, spec: artifact.spec, u: artifact.u, v: artifact.v });
const get = handle => {
  const state = handle && typeof handle === 'object' ? owned.get(handle) : null;
  if (!state) throw fail('Original live directional query adapter required.'); return state;
};
const validateSpec = input => {
  const spec = captureRetrievalAdaptation('spec', input), { query, document } = spec;
  if (query.dimensions !== document.dimensions || spec.rank > query.dimensions) throw fail('Residual adapter width/rank disagrees with its directional spaces.');
  for (const contract of [query, document]) {
    assertEmbeddingArtifactCompatibility(contract.artifact, contract.artifact);
    if (contract.artifact.status === 'immutable-revision' && !contract.artifact.revision) throw fail('An immutable encoder revision must be named.');
  }
  if ((document.representation === 'original-float32') !== (document.quantizationId === null)) throw fail('Stored and original document targets require distinct quantization identities.');
  if ((spec.purpose === 'identity-control') !== (spec.trainingCohortId === null && spec.splitManifestId === null)
    || spec.purpose === 'trained-candidate' && (!spec.trainingCohortId || !spec.splitManifestId || !spec.sourceDependencies.length)) {
    throw fail('Training lineage must be complete and separate from an untrained identity control.');
  }
  return spec;
};

const captureNumbers = (input, length) => {
  if (!input || typeof input !== 'object' || types.isProxy(input)
    || ![Array.prototype, Float32Array.prototype, Float64Array.prototype].includes(Object.getPrototypeOf(input))
    || input.length !== length || ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) throw fail('Exact bounded private numerical storage required.');
  const numbers = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index)), value = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof value !== 'number' || !Number.isFinite(value)
      || !Number.isFinite(Math.fround(value))) throw fail('Factors must contain finite Float32 values without accessors or holes.');
    const rounded = Math.fround(value); numbers[index] = rounded === 0 ? 0 : rounded;
  }
  return numbers;
};
const copyFactors = (input, length) => {
  const numbers = captureNumbers(input, length), bytes = Buffer.alloc(length * 4);
  for (let index = 0; index < length; index++) bytes.writeFloatLE(numbers[index], index * 4);
  return Object.freeze({ encoding: 'float32-le-base64', sha256: bytesHash(bytes), data: bytes.toString('base64') });
};
const decodeFactors = (factor, length) => {
  const bytes = Buffer.from(factor.data, 'base64');
  if (bytes.length !== length * 4 || bytes.toString('base64') !== factor.data || bytesHash(bytes) !== factor.sha256) throw fail('Factor encoding, byte extent or SHA-256 changed.');
  const values = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const value = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(value) || Object.is(value, -0)) throw fail('Factors require canonical finite Float32 bytes.');
    values[index] = value;
  }
  return values;
};

/** Offline export only. No filesystem publication, model loading, activation or
 * document mutation is implied by constructing this content-addressed value.
 */
export const createDirectionalQueryArtifact = ({ spec: input, u, v }) => {
  const spec = validateSpec(input), length = spec.query.dimensions * spec.rank;
  const content = Object.freeze({ schemaVersion: 1, kind: 'directional-query-adapter', spec,
    u: copyFactors(u, length), v: copyFactors(v, length) });
  if (spec.purpose === 'identity-control' && decodeFactors(content.u, length).some(value => value !== 0)) throw fail('Identity controls require U=0.');
  return Object.freeze({ ...content, pairId: hash('artifact', content) });
};

/** U=0 preserves the identity function; seeded nonzero V retains a usable first
 * U gradient. V is row-major (dimensions, rank), with a declared PRNG version.
 */
export const createIdentityDirectionalQueryArtifact = (input, { seed = 'directional-identity-v1' } = {}) => {
  const spec = validateSpec(input);
  if (spec.purpose !== 'identity-control' || typeof seed !== 'string' || !seed.length || Buffer.byteLength(seed) > 1024) throw fail('A bounded seed and identity-control spec are required.');
  const length = spec.query.dimensions * spec.rank, u = new Float32Array(length), v = new Float32Array(length);
  let state = createHash('sha256').update('xorshift32-directional-v1\0').update(seed).digest().readUInt32LE(0) || 0x9e3779b9;
  for (let index = 0; index < length; index++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    v[index] = ((state >>> 0) + 0.5) / 4294967296 * 0.002 - 0.001;
  }
  return createDirectionalQueryArtifact({ spec, u, v });
};

/** Copies and verifies actual factor bytes before admitting a private adapter.
 * The returned token exposes no mutable factors. It carries no policy eligibility.
 */
export const openDirectionalQueryAdapter = input => {
  const artifact = captureRetrievalAdaptation('artifact', input), spec = validateSpec(artifact.spec);
  if (artifact.pairId !== hash('artifact', artifactContent(artifact))) throw fail('Directional artifact identity changed.');
  const length = spec.query.dimensions * spec.rank, u = decodeFactors(artifact.u, length), v = decodeFactors(artifact.v, length);
  if (spec.purpose === 'identity-control' && u.some(value => value !== 0)) throw fail('Identity control factors changed.');
  const handle = Object.freeze({ version: 1 });
  owned.set(handle, { artifact, spec, u, v, queryContractId: hash('query-contract', spec.query),
    documentSpaceId: hash('document-space', spec.document) }); return handle;
};
export const exportDirectionalQueryAdapter = handle => get(handle).artifact;
export const inspectDirectionalQueryAdapter = handle => {
  const { artifact, spec, queryContractId, documentSpaceId } = get(handle);
  return Object.freeze({ schemaVersion: 1, pairId: artifact.pairId, queryContractId, documentSpaceId,
    dimensions: spec.query.dimensions, rank: spec.rank, kernel: spec.kernel, policyQualification: 'not-established',
    deployment: 'offline-candidate-only', documentMutation: 'none' });
};

/** q = normalize(e + U(V^T e)). Float32 input/factors, Float64 accumulators,
 * Float32 output. Work/storage are O(d*r); no dense d*d matrix is constructed.
 * The caller must supply the contract of its actually opened document target.
 * These descriptors do not grant a generation lease or live source authority.
 */
export const projectDirectionalQuery = (handle, { query, queryContract, documentContract }) => {
  const state = get(handle), { spec, u, v } = state;
  queryContract = captureRetrievalAdaptation('query', queryContract); documentContract = captureRetrievalAdaptation('document', documentContract);
  if (hash('query-contract', queryContract) !== state.queryContractId || hash('document-space', documentContract) !== state.documentSpaceId) throw fail('Actual query/document contracts disagree with this directional pair.');
  const d = spec.query.dimensions, r = spec.rank;
  const input = captureNumbers(query, d), middle = new Float64Array(r), projected = new Float64Array(d);
  admitEmbeddingVector(input, { dimensions: d, requireNonzero: true });
  for (let row = 0; row < d; row++) for (let column = 0; column < r; column++) middle[column] += v[row * r + column] * input[row];
  let norm = 0;
  for (let row = 0; row < d; row++) {
    let value = input[row];
    for (let column = 0; column < r; column++) value += u[row * r + column] * middle[column];
    if (!Number.isFinite(value)) throw fail('Residual query is nonfinite.');
    projected[row] = value; norm = Math.hypot(norm, value);
  }
  if (!(norm > 0) || !Number.isFinite(norm)) throw fail('Residual query has zero or invalid norm.');
  const vector = Float32Array.from(projected, value => value / norm);
  admitEmbeddingVector(vector, { dimensions: d, requireNonzero: true, unitNorm: true });
  return Object.freeze({ vector, pairId: state.artifact.pairId, queryContractId: state.queryContractId,
    documentSpaceId: state.documentSpaceId, queryCacheIdentity: state.artifact.pairId,
    work: Object.freeze({ factorMultiplyAdds: 2 * d * r, residualAdds: d, normalizationElements: d,
      denseMatrixMaterialized: false }), policyQualification: 'not-established' });
};
export const disposeDirectionalQueryAdapter = handle => {
  if (handle && typeof handle === 'object' && retired.has(handle)) return retired.get(handle);
  const { artifact } = get(handle), receipt = Object.freeze({ schemaVersion: 1, pairId: artifact.pairId,
    status: 'retired', nativeResources: 'none' });
  owned.delete(handle); retired.set(handle, receipt); return receipt;
};
