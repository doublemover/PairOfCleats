import { randomUUID } from 'node:crypto';

/** Observe the real captured controls operation, then inspect pixels in that
 * same submission. Merely replacing renderer.render misses captured callbacks. */
export const captureRenderedViewerFrame = async page => {
  const token = randomUUID();
  let primary, result;
  try {
    await page.waitForFunction(async () => {
      const { state } = await import('/isomap/state.js');
      return state.renderer && state.scene && state.camera && state.fileGroup?.children.length && !state.preparingScene;
    });
    await page.evaluate(async token => {
      const { state } = await import('/isomap/state.js');
      const { observeNextSceneRender } = await import('/isomap/rendering/scene-render-submission.js');
      if (globalThis.__pairofcleatsQualificationFrame) throw new Error('Previous frame observation has not been released.');
      const renderer = state.renderer, originalScene = state.scene, originalCamera = state.camera;
      const owner = { token, result: null, error: null, cancel: null };
      globalThis.__pairofcleatsQualificationFrame = owner;
      try {
        owner.cancel = observeNextSceneRender(renderer, {
          onError: error => { owner.error = error.message; },
          onFrame: submission => {
            try {
              if (state.renderer !== renderer || state.scene !== originalScene || state.camera !== originalCamera) throw new Error('Original viewer scene changed.');
              if (!Number.isSafeInteger(submission.geometryRevision) || submission.geometryRevision < 1
                || !Number.isSafeInteger(submission.frameBefore) || !Number.isSafeInteger(submission.frame)
                || submission.frame <= submission.frameBefore || submission.calls <= 0 || submission.triangles <= 2) {
                throw new Error('No completed useful scene geometry submission.');
              }
              const gl = renderer.getContext(), canvas = renderer.domElement;
              if (gl.isContextLost() || canvas.width <= 0 || canvas.height <= 0) throw new Error('Rendered scene context is unavailable.');
              const colors = new Set(), pixel = new Uint8Array(4);
              for (let y = 1; y <= 7; y++) for (let x = 1; x <= 9; x++) {
                gl.readPixels(Math.floor(canvas.width * x / 10), Math.floor(canvas.height * y / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                colors.add(`${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]}`);
              }
              if (gl.getError() !== gl.NO_ERROR || colors.size < 3) throw new Error('Rendered scene pixel invariant failed.');
              const modelJson = JSON.stringify(state.map);
              if (typeof modelJson !== 'string' || modelJson.length > 2097152) throw new Error('Committed fixture model exceeds frame identity allowance.');
              owner.identity = { renderer, scene: originalScene, camera: originalCamera, model: state.map,
                layout: state.layoutMetrics, revision: state.geometryRevision };
              owner.result = { ...submission, modelJson, sampledColors: colors.size, width: canvas.width, height: canvas.height,
                dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } };
            } catch (error) { owner.error = error.message; }
          }
        });
        if (typeof state.invalidateRender !== 'function') throw new Error('No original render invalidation owner is active.');
        state.invalidateRender();
      } catch (error) { owner.cancel?.(); delete globalThis.__pairofcleatsQualificationFrame; throw error; }
    }, token);
    await page.waitForFunction(token => {
      const owner = globalThis.__pairofcleatsQualificationFrame;
      return owner?.token === token && (owner.result || owner.error);
    }, token);
    result = await page.evaluate(async token => {
      const owner = globalThis.__pairofcleatsQualificationFrame;
      if (owner?.token !== token) throw new Error('Frame observation ownership changed.');
      if (owner.error) throw new Error(owner.error);
      const { modelJson, ...frame } = owner.result;
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(modelJson));
      const { state } = await import('/isomap/state.js');
      const identity = owner.identity;
      if (state.renderer !== identity.renderer || state.scene !== identity.scene || state.camera !== identity.camera
        || state.map !== identity.model || state.layoutMetrics !== identity.layout || state.geometryRevision !== identity.revision
        || state.preparingScene || state.contextLost) throw new Error('Committed scene changed before frame receipt handoff.');
      return { ...frame, modelSha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
        requestedRenderer: 'ANGLE SwiftShader',
        fidelity: 'software-rendered submitted frame and sampled known-scene pixel variation; hardware/FPS not measured' };
    }, token);
  } catch (error) { primary = error; }
  try {
    await page.evaluate(token => {
      const owner = globalThis.__pairofcleatsQualificationFrame;
      if (owner?.token !== token) return;
      owner.cancel?.(); delete globalThis.__pairofcleatsQualificationFrame;
    }, token);
  } catch (cleanup) {
    if (primary) throw new AggregateError([primary, cleanup], 'Frame observation and cleanup failed.', { cause: primary });
    throw cleanup;
  }
  if (primary) throw primary;
  return result;
};
