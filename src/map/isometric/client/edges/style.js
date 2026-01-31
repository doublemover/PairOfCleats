export const createEdgeStyleHelpers = ({ state }) => {
  const edgeStyles = state.map.legend?.edgeStyles || {};
  const edgeTypeAliases = state.map.legend?.edgeTypes || {};
  const resolveEdgeType = (type) => (edgeStyles[type] ? type : (edgeTypeAliases[type] || type));
  const resolveEdgeStyle = (type) => edgeStyles[resolveEdgeType(type)] || edgeStyles[type] || {};

  return {
    resolveEdgeType,
    resolveEdgeStyle
  };
};

export const createFlowMaterial = ({ THREE, visuals, applyHeightFog, type, typeProfile, style }) => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.8,
    envMapIntensity: visuals.glass.envMapIntensity,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    vertexColors: true
  });
  if ('toneMapped' in material) material.toneMapped = false;
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveIntensity = visuals.flowGlowBase;
  const typeHash = Array.from(String(type)).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  material.userData = {
    glowBase: visuals.flowGlowBase,
    glowRange: visuals.flowGlowRange,
    baseEmissiveIntensity: visuals.flowGlowBase,
    baseOpacity: 0.8,
    flowPhase: typeHash * 0.17,
    flowDir: 1,
    flowSpeed: typeProfile.speed || 1,
    flowOffset: typeProfile.phase || 0,
    baseColor: style.color || null
  };
  const prevCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (typeof prevCompile === 'function') prevCompile(shader);
    if (shader.fragmentShader.includes('vColor')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor;'
      );
    }
  };
  applyHeightFog(material);
  return material;
};

export const resolveSegmentStyle = ({ THREE, entry, style, fallbackColor, edgeHighlight }) => {
  const thickness = 0.08 + Math.log1p(entry.weight) * 0.04;
  const colorWeight = entry.colorWeight || 0;
  const averaged = colorWeight
    ? new THREE.Color(entry.rSum / colorWeight, entry.gSum / colorWeight, entry.bSum / colorWeight)
    : fallbackColor.clone();
  const edgeBase = style.color ? new THREE.Color(style.color) : averaged;
  const brightColor = edgeBase.clone().lerp(edgeHighlight, 0.65);
  const highlightColor = brightColor.clone().lerp(edgeHighlight, 0.35);
  const flowDirection = entry.dirSum >= 0 ? 1 : -1;
  return {
    thickness,
    brightColor,
    highlightColor,
    flowDirection
  };
};
