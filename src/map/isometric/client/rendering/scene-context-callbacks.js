import { captureSceneFailure } from '../scene-failure-inspection.js';
import { getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../scene-retirement.js';

/** Native listener callbacks retain their original scene authority. A late
 * listener or a reentrant replacement cannot adopt the current sibling state. */
export const createSceneContextCallbacks = ({ state, isCurrent, retainFailure, retirePicking }) => {
  const report = errors => {
    if (!errors.length) return null;
    const failure = preserveSceneCleanupFailures(errors[0], errors.slice(1), { hasPrimary: true, forceAggregate: true });
    retainFailure(failure);
    if (isCurrent()) {
      state.rendererContextFailure = failure; state.rendererContextError = failure.message;
      state.sceneRetirementOwners = getPendingSceneResourceOwners();
    }
    return failure;
  };
  const run = (action, errors) => {
    if (!isCurrent()) return;
    try { action(); } catch (error) { errors.push(error); }
  };
  return Object.freeze({
    lost(event) {
      if (!isCurrent()) return null;
      const errors = [];
      run(() => event.preventDefault(), errors);
      if (isCurrent()) state.contextLost = true;
      run(() => state.cancelResidentPreparation?.(), errors);
      run(retirePicking, errors);
      run(() => state.cancelCameraMotion?.(), errors);
      run(() => state.onRendererStatus?.('3D context lost. Source evidence remains available; waiting for restoration.'), errors);
      return report(errors);
    },
    restored() {
      if (!isCurrent()) return null;
      state.contextLost = false;
      const errors = [];
      run(() => state.rebuildAfterContextRestore?.(), errors);
      if (!errors.length) run(() => state.invalidateRender?.(), errors);
      if (errors.length) run(() => state.onRendererStatus?.(
        `3D restore failed: ${captureSceneFailure(errors[0]).message}. Source evidence remains available.`), errors);
      return report(errors);
    }
  });
};
