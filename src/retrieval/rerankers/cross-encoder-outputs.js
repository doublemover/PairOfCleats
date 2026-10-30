import { captureRerankerFailure } from './failure-inspection.js';

const objectLike = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_LOCAL_RERANKER_OUTPUT' });

/** Retain each inspectable original output independently before decoding. An
 * opaque key/accessor is not proof that all returned native children are owned;
 * keep that exact container pending instead of adopting replacement getters. */
export const captureCrossEncoderOutputs = (outputs, tensors) => {
  if (!objectLike(outputs)) throw invalid('Cross-encoder outputs require an original named tensor object.');
  const errors = [], values = new Map(); let incomplete = false, keys = [];
  if (Array.isArray(outputs)) errors.push(invalid('Cross-encoder outputs require a named tensor object, not an array.'));
  try { keys = Reflect.ownKeys(outputs); }
  catch (error) { errors.push(error); incomplete = true; }
  if (keys.length > 64) {
    errors.push(invalid('Cross-encoder output inspection exceeds64 original names.'));
    keys = keys.slice(0, 64); incomplete = true;
  }
  for (const key of keys) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(outputs, key); }
    catch (error) { errors.push(error); incomplete = true; continue; }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      errors.push(invalid('Cross-encoder output names require original data properties; opaque/accessor children remain unqualified.'));
      incomplete = true; continue;
    }
    const value = descriptor.value;
    if (!objectLike(value)) { errors.push(invalid('Cross-encoder named output is not a returned tensor resource.')); continue; }
    values.set(key, value);
    try { tensors.add(value); } catch (error) { errors.push(error); }
  }
  if (!values.has('logits')) errors.push(invalid('Cross-encoder output has no original logits tensor.'));
  if (errors.length) {
    const snapshots = errors.map(captureRerankerFailure);
    const owner = Object.freeze({ kind: 'local-cross-encoder-output-inspection', outputs,
      get pending() { return incomplete || snapshots.some(snapshot => { snapshot.refresh(); return !snapshot.released(); }); } });
    const inspectionErrors = [...new Set(snapshots.flatMap(snapshot => snapshot.inspectionErrors))];
    const failure = new AggregateError([...errors, ...inspectionErrors], 'Local cross-encoder output admission failed.', { cause: errors[0] });
    Object.defineProperties(failure, { code: { value: 'ERR_LOCAL_RERANKER_OUTPUT' }, rerankerOwner: { value: owner },
      rerankerInspectionErrors: { value: Object.freeze(inspectionErrors) },
      cacheOwnershipPending: { get: () => owner.pending }, cacheOwnershipReleased: { value: () => !owner.pending } });
    throw failure;
  }
  return values.get('logits');
};
