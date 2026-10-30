/** A completed acquisition belongs to its caller before cancellation is checked
 * again. Otherwise the post-await abort can hide its original cleanup owner. */
export const runQualificationPhase = async ({ name, operation, signal, observe, phases, adopt = null }) => {
  signal.throwIfAborted();
  const began = performance.now(); observe(name + ':before');
  const value = await operation();
  if (adopt) adopt(value);
  observe(name + ':after');
  phases.push({ name, elapsedMs: performance.now() - began });
  signal.throwIfAborted();
  return value;
};
