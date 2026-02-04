export const resolveLodTier = ({ zoom, edgeCount, frameMs, performance }) => {
  const lod = performance?.lod || {};
  const budget = Number.isFinite(performance?.frameBudgetMs) ? performance.frameBudgetMs : 18;
  const zoomHigh = Number.isFinite(lod.zoomHigh) ? lod.zoomHigh : 20;
  const zoomLow = Number.isFinite(lod.zoomLow) ? lod.zoomLow : 6;
  const edgeHigh = Number.isFinite(lod.edgeCountHigh) ? lod.edgeCountHigh : 12000;
  const edgeLow = Number.isFinite(lod.edgeCountLow) ? lod.edgeCountLow : 3000;

  if (edgeCount >= edgeHigh || zoom < zoomLow || frameMs > budget * 1.4) return 'hidden';
  if (edgeCount >= edgeLow || zoom < zoomHigh || frameMs > budget * 1.05) return 'simplified';
  return 'full';
};

export const applyLodTier = (state, tier) => {
  if (!state || !tier) return;
  if (state.lodTier === tier) return;
  state.lodTier = tier;

  const edgeGroup = state.edgeGroup;
  const labelGroup = state.labelGroup;
  const edgeHiddenByUser = edgeGroup?.userData?.userHidden === true;
  const labelHiddenByUser = labelGroup?.userData?.userHidden === true;

  if (edgeGroup) {
    edgeGroup.visible = !edgeHiddenByUser && tier !== 'hidden';
  }
  if (labelGroup) {
    labelGroup.visible = !labelHiddenByUser && tier === 'full';
  }

  if (state.edgeDotMesh) {
    state.edgeDotMesh.visible = tier === 'full';
  }

  if (state.flowLights) {
    const baseIntensity = tier === 'full' ? 1 : 0;
    state.flowLights.forEach((light) => {
      light.intensity = baseIntensity ? (light.userData?.base || 1) : 0;
    });
  }
};
