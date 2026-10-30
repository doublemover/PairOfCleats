import { canonicalSemanticJson } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';
import { createHash } from 'node:crypto';
import { describeStorageFailure } from '../../../shared/storage/failure-observation.js';

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = (message, cause) => { throw Object.assign(new TypeError(message, { cause }), { code: 'ERR_NATIVE_BRIDGE_MANIFEST' }); };
const same = (left, right, maxBytes) => canonicalSemanticJson(left, { maxBytes }) === canonicalSemanticJson(right, { maxBytes });
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const freeze = value => {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    for (const child of Object.values(item)) if (child && typeof child === 'object') pending.push(child);
    Object.freeze(item);
  }
  return value;
};

/** Strict data-only descriptor intake. No import, debugger, binary loading or producer execution. */
export const admitNativeBridgeManifest = ({ manifest, expectedWorld, expectedRuntime, artifacts,
  supportedLayouts, maxBytes = 4 * 1024 * 1024 }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) invalid('Native manifest byte allowance must be a positive safe integer.');
  let encoded;
  try { encoded = canonicalSemanticJson(manifest, { maxBytes }); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'native-manifest-byte-admission' }).code === 'ERR_SEMANTIC_JSON_BUDGET') throw error;
    invalid('Native bridge manifest requires passive bounded JSON.', error);
  }
  // One admitted representation owns containers before field validation. Shared
  // caller arrays count at every logical occurrence; no unbounded clone follows.
  manifest = JSON.parse(encoded);
  const names = ['schemaVersion', 'world', 'runtime', 'producer', 'observation', 'binaries', 'bindings', 'coverage'];
  if (!fields(manifest, names) || manifest.schemaVersion !== 1) invalid('Unsupported or extended native bridge manifest.');
  if (!manifest.world || !validateSemanticEnvelope('generation', manifest.world.generation).ok
    || !same(manifest.world, expectedWorld, maxBytes)) invalid('Stale native bridge source/build identity.');
  if (!fields(manifest.runtime, ['implementation', 'version', 'abi', 'layoutProfile', 'os', 'architecture'])
    || Object.values(manifest.runtime).some(value => !text(value)) || !same(manifest.runtime, expectedRuntime, maxBytes)) {
    invalid('Native bridge runtime/ABI/target mismatch.');
  }
  if (!fields(manifest.producer, ['id', 'version', 'optionsHash']) || !text(manifest.producer.id)
    || !text(manifest.producer.version) || !hash(manifest.producer.optionsHash)) invalid('Producer provenance required.');
  if (!fields(manifest.observation, ['mode', 'snapshotId', 'roots'])
    || !['static-registration', 'supplied-runtime-observation'].includes(manifest.observation.mode)
    || !text(manifest.observation.snapshotId) || !Array.isArray(manifest.observation.roots)
    || manifest.observation.roots.length > 4096 || manifest.observation.roots.some(root => !text(root))) invalid('Qualified supplied observation required.');
  if (!(artifacts instanceof Map) || !Array.isArray(supportedLayouts) || !Array.isArray(manifest.binaries)
    || manifest.binaries.length > 256 || !Array.isArray(manifest.bindings) || manifest.bindings.length > 16384) invalid('Bounded artifact/binding inventory required.');
  const binaryIds = new Set();
  for (const binary of manifest.binaries) {
    if (!fields(binary, ['id', 'byteHash', 'buildId', 'symbolIdentity', 'debugIdentity'])
      || !text(binary.id) || binaryIds.has(binary.id) || !hash(binary.byteHash)
      || !text(binary.buildId) || !(binary.symbolIdentity === null || text(binary.symbolIdentity))
      || !(binary.debugIdentity === null || text(binary.debugIdentity))) invalid('Invalid binary identity.');
    binaryIds.add(binary.id);
    if (artifacts.get(binary.id)?.byteHash !== binary.byteHash
      || artifacts.get(binary.id)?.buildId !== binary.buildId) invalid('Missing or stale admitted binary artifact.');
  }
  const bindingIds = new Set();
  for (const binding of manifest.bindings) {
    if (!fields(binding, ['id', 'pythonCallable', 'binaryId', 'symbol', 'imageOffset', 'wrapperChain', 'sourceRef', 'relation'])
      || !text(binding.id) || bindingIds.has(binding.id) || !text(binding.pythonCallable)
      || !binaryIds.has(binding.binaryId) || !(binding.symbol === null || text(binding.symbol))
      || !Number.isSafeInteger(binding.imageOffset) || binding.imageOffset < 0
      || !Array.isArray(binding.wrapperChain) || binding.wrapperChain.length > 64
      || binding.wrapperChain.some(value => !text(value))
      || !(binding.sourceRef === null || text(binding.sourceRef))
      || !['registration', 'binding-observation'].includes(binding.relation)) invalid('Invalid native binding descriptor.');
    if (manifest.observation.mode === 'static-registration' && binding.relation !== 'registration') invalid('Static reports cannot assert runtime observations.');
    bindingIds.add(binding.id);
  }
  if (!fields(manifest.coverage, ['discovery', 'callableClasses', 'unsupportedLayouts', 'failures', 'callbacks', 'lateRegistration', 'dlopen', 'ctypes'])) {
    invalid('Explicit native observation coverage required.');
  }
  for (const name of ['discovery', 'callbacks', 'lateRegistration', 'dlopen', 'ctypes']) {
    if (!['complete-in-snapshot', 'partial', 'unavailable'].includes(manifest.coverage[name])) invalid('Invalid native coverage state.');
  }
  for (const name of ['callableClasses', 'unsupportedLayouts', 'failures']) {
    if (!Array.isArray(manifest.coverage[name]) || manifest.coverage[name].length > 4096
      || manifest.coverage[name].some(value => !text(value))) invalid('Invalid native coverage inventory.');
  }
  const layoutSupported = supportedLayouts.includes(manifest.runtime.layoutProfile);
  return freeze({ manifestId: createHash('sha256').update('pairofcleats.native-bridge-manifest.v1\0', 'utf8').update(encoded, 'utf8').digest('hex'),
    manifest, layoutSupported,
    claim: manifest.observation.mode === 'static-registration' ? 'registered-binding' : 'observed-binding',
    invocationEvidence: 'not-supplied', effectSummary: 'not-supplied',
    globalClosure: 'not-established', unsupported: layoutSupported ? [] : ['runtime-layout'] });
};

/** Observability and reachability are independent; absent candidates never mean unreachable. */
export const observeNativeBoundaryTarget = (admitted, { binaryId, symbol = null, imageOffset = null }) => {
  if (!text(binaryId) || !(symbol === null || text(symbol))
    || !(imageOffset === null || Number.isSafeInteger(imageOffset) && imageOffset >= 0)
    || symbol === null && imageOffset === null) invalid('Exact qualified native target required.');
  if (!admitted.layoutSupported) return { observability: 'unknown', reason: 'unsupported-layout', reachability: 'unknown', bindings: [] };
  const binary = admitted.manifest.binaries.find(row => row.id === binaryId);
  if (!binary) return { observability: 'targetNotObservable', reason: 'artifact-absent', reachability: 'unknown', bindings: [] };
  const bindings = admitted.manifest.bindings.filter(row => row.binaryId === binaryId
    && (symbol === null || row.symbol === symbol) && (imageOffset === null || row.imageOffset === imageOffset));
  if (bindings.length) return { observability: 'observable', reason: 'qualified-binding', reachability: 'unknown',
    claim: admitted.claim, bindings: structuredClone(bindings), manifestId: admitted.manifestId };
  return { observability: symbol !== null && binary.symbolIdentity === null ? 'targetNotObservable' : 'unknown',
    reason: symbol !== null && binary.symbolIdentity === null ? 'symbol-map-absent' : 'binding-not-in-observation',
    reachability: 'unknown', bindings: [] };
};
