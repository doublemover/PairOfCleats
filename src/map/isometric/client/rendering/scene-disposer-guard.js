const originalGuards = new WeakMap();

/** Actual scene producers bind a guard to their original disposer function.
 * Copied public properties or a similar callback cannot receive this binding. */
export const createSceneDisposerGuard = ({ dispose, receiver, beforeDispose, retainFailure }) => {
  if (![dispose, beforeDispose, retainFailure].every(value => typeof value === 'function')) {
    throw new TypeError('Scene disposer requires original captured guard functions.');
  }
  const guarded = (...args) => { beforeDispose(); return Reflect.apply(dispose, receiver, args); };
  originalGuards.set(guarded, retainFailure);
  return guarded;
};

export const retainSceneDisposerFailure = (dispose, error) => {
  const retain = typeof dispose === 'function' && originalGuards.get(dispose);
  if (!retain) return false;
  retain(error); return true;
};
