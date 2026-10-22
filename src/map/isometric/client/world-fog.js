const varying = 'vIsoWorldPosition';

// Three's mesh pipeline transforms geometry before batching, instancing and
// model/parent transforms. Wide lines instead represent view-space extrusion.
export const injectWorldFogPosition = (shader, { wideLine = false } = {}) => {
  if (!shader.vertexShader.includes('#include <fog_vertex>')
    || !shader.vertexShader.includes('#include <common>')) {
    throw new Error('Height fog requires supported world-position shader chunks.');
  }
  const position = wideLine ? `
    #ifdef WORLD_UNITS
      vec3 isoFogView = worldPos.xyz;
    #else
      vec3 isoFogView = mvPosition.xyz;
    #endif
    ${varying} = vec3(dot(viewMatrix[0].xyz, isoFogView),
      dot(viewMatrix[1].xyz, isoFogView), dot(viewMatrix[2].xyz, isoFogView)) + cameraPosition;
  ` : `
    vec4 isoFogWorld = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      isoFogWorld = batchingMatrix * isoFogWorld;
    #endif
    #ifdef USE_INSTANCING
      isoFogWorld = instanceMatrix * isoFogWorld;
    #endif
    ${varying} = (modelMatrix * isoFogWorld).xyz;
  `;
  shader.vertexShader = shader.vertexShader.replace('#include <common>',
    `#include <common>\nvarying vec3 ${varying};`);
  shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>',
    `#include <fog_vertex>\n${position}`);
};
