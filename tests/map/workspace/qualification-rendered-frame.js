/** Observe actual application render submission; no product debug flag or fake
 * DOM readiness substitutes for a completed frame of the selected scene. */
export const captureRenderedViewerFrame = async page => {
  await page.waitForFunction(async () => {
    const { state } = await import('/isomap/state.js');
    return state.renderer && state.scene && state.camera && state.fileGroup?.children.length;
  });
  await page.evaluate(async () => {
    const { state } = await import('/isomap/state.js');
    const renderer = state.renderer;
    if (!renderer.__qualificationRenderOwner) {
      const owner = { pending: false, result: null, error: null, sequence: 0 };
      const original = renderer.render;
      renderer.render = function(scene, camera) {
        const model = state.map, layout = state.layoutMetrics;
        const before = this.info.render.frame;
        const result = original.call(this, scene, camera);
        if (!owner.pending || scene !== state.scene || camera !== state.camera) return result;
        owner.pending = false;
        try {
          if (state.map !== model || state.layoutMetrics !== layout) throw new Error('Scene generation changed during render submission.');
          const info = this.info.render, gl = this.getContext();
          if (info.frame <= before || info.calls <= 0 || info.triangles <= 2 || gl.isContextLost()) throw new Error('No completed useful scene geometry submission.');
          const colors = new Set(), pixel = new Uint8Array(4), canvas = this.domElement;
          for (let y = 1; y <= 7; y++) for (let x = 1; x <= 9; x++) {
            gl.readPixels(Math.floor(canvas.width * x / 10), Math.floor(canvas.height * y / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            colors.add(`${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]}`);
          }
          if (gl.getError() !== gl.NO_ERROR || colors.size < 3) throw new Error('Rendered scene pixel invariant failed.');
          owner.result = { sequence: ++owner.sequence, scene: scene.uuid,
            sceneGeneration: [state.fileGroup, state.memberGroup, state.edgeGroup].map(group => group?.children.map(child => child.uuid).join(',') || '').join('|'),
            frame: info.frame, calls: info.calls, triangles: info.triangles, sampledColors: colors.size,
            width: canvas.width, height: canvas.height, dpr: devicePixelRatio };
        } catch (error) { owner.error = error.message; }
        return result;
      };
      Object.defineProperty(renderer, '__qualificationRenderOwner', { value: owner });
    }
    const owner = renderer.__qualificationRenderOwner;
    owner.result = null; owner.error = null; owner.pending = true;
  });
  await page.waitForFunction(async () => {
    const { state } = await import('/isomap/state.js');
    const owner = state.renderer?.__qualificationRenderOwner;
    return owner?.result || owner?.error;
  });
  return page.evaluate(async () => {
    const { state } = await import('/isomap/state.js');
    const owner = state.renderer.__qualificationRenderOwner;
    if (owner.error) throw new Error(owner.error);
    const source = document.getElementById('map-data')?.textContent || '';
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    return { ...owner.result, modelSha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      viewport: { width: innerWidth, height: innerHeight }, requestedRenderer: 'ANGLE SwiftShader',
      fidelity: 'software-rendered submitted frame and sampled known-scene pixel variation; hardware/FPS not measured' };
  });
};
