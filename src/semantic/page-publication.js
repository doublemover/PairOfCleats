const pending = new WeakMap();

/** A private result capability holds refs/offsets only. The enclosing runner
 * commits it after all native stores and final response projections settle.
 */
export const stageSemanticPagePublication = (result, publish, deferred = false) => {
  if (deferred) pending.set(result, publish);
  else publish();
  return result;
};
export const publishSemanticPage = result => {
  const publish = pending.get(result);
  pending.delete(result);
  publish?.();
  return result;
};
