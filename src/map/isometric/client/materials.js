import { state } from './state.js';
import { clamp, numberValue } from './utils.js';

export const initMaterials = () => {
  const { THREE, assets, visuals } = state;
  state.glowMaterials = [];
  state.flowMaterials = [];
  state.glassMaterials = [];
  state.labelMaterials = [];
  state.glassShells = [];
  state.wireMaterials = [];
  state.gridLineMaterials = [];
  state.normalMapState = { texture: null };

  if (assets.normalMapUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(assets.normalMapUrl, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(visuals.glass.normalRepeat, visuals.glass.normalRepeat);
      texture.userData = { ...(texture.userData || {}), shared: true };
      state.normalMapState.texture = texture;
      applyGlassSettings();
    });
  }
};

export const applyHeightFog = (material) => {
  const { visuals } = state;
  if (!material || material.userData?.heightFogApplied) return;
  material.userData.heightFogApplied = true;
  const fogVarying = 'vIsoWorldPosition';
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (typeof previousCompile === 'function') {
      previousCompile(shader);
    }
    shader.uniforms.fogHeight = { value: visuals.fogHeight };
    shader.uniforms.fogHeightRange = { value: visuals.fogHeightRange };
    shader.uniforms.fogHeightEnabled = { value: visuals.enableHeightFog ? 1 : 0 };
    if (!shader.vertexShader.includes(`varying vec3 ${fogVarying}`)) {
      if (shader.vertexShader.includes('#include <common>')) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>\n  varying vec3 ${fogVarying};`
        );
      }
    }
    if (shader.vertexShader.includes('#include <fog_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>\n  ${fogVarying} = (modelMatrix * vec4(position, 1.0)).xyz;`
      );
    }
    if (!shader.fragmentShader.includes(`varying vec3 ${fogVarying}`)) {
      if (shader.fragmentShader.includes('#include <common>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>\n  varying vec3 ${fogVarying};`
        );
      }
    }
    if (!shader.fragmentShader.includes('uniform float fogHeight')) {
      if (shader.fragmentShader.includes('#include <fog_pars_fragment>')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <fog_pars_fragment>',
          '#include <fog_pars_fragment>\n  uniform float fogHeight;\n  uniform float fogHeightRange;\n  uniform float fogHeightEnabled;'
        );
      }
    }
    if (shader.fragmentShader.includes('#include <fog_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG\n  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);\n  float heightFactor = fogHeightEnabled * clamp((fogHeight - ${fogVarying}.y) / max(0.001, fogHeightRange), 0.0, 1.0);\n  float combinedFog = max(fogFactor, heightFactor);\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, combinedFog);\n#endif`
      );
    }
    material.userData.fogUniforms = shader.uniforms;
  };
  material.needsUpdate = true;
};

export const createGlassMaterial = (color, opacity) => {
  const { THREE, visuals, normalMapState, glassMaterials, glowMaterials } = state;
  const glass = visuals.glass || state.visualDefaults.glass;

  const transmission = clamp(glass.transmission ?? 0, 0, 1);
  // Perceptual curve: prevents the slider from behaving like "all or nothing".
  const tCurve = Math.pow(transmission, 2.2);
  const envScale = 0.35 + 0.65 * tCurve;

  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: glass.metalness,
    roughness: glass.roughness,
    transmission: tCurve,
    ior: glass.ior,
    reflectivity: glass.reflectivity,
    thickness: glass.thickness,
    envMapIntensity: glass.envMapIntensity * envScale,
    clearcoat: glass.clearcoat,
    clearcoatRoughness: glass.clearcoatRoughness,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  material.attenuationDistance = tCurve > 0 ? (2 + 120 * tCurve) : 0;
  material.attenuationColor = color.clone();

  material.emissive = color.clone().multiplyScalar(0.22);
  material.emissiveIntensity = 0.35;
  material.userData = {
    glowBase: 0.35,
    glowRange: 0.25,
    baseColor: color.clone(),
    baseEmissive: material.emissive.clone(),
    baseEmissiveIntensity: material.emissiveIntensity,
    baseOpacity: opacity
  };

  if (normalMapState.texture) {
    material.normalMap = normalMapState.texture;
    material.clearcoatNormalMap = normalMapState.texture;
    material.normalScale = new THREE.Vector2(glass.normalScale, glass.normalScale);
    material.clearcoatNormalScale = new THREE.Vector2(glass.clearcoatNormalScale, glass.clearcoatNormalScale);
  }

  glassMaterials.push(material);
  glowMaterials.push(material);
  applyHeightFog(material);
  return material;
};

export const createGlassShell = (geometry, material) => {
  const { THREE, visuals, glassMaterials, glowMaterials, glassShells } = state;
  const outer = new THREE.Mesh(geometry, material);
  const innerMaterial = material.clone();
  innerMaterial.side = THREE.BackSide;
  innerMaterial.opacity = clamp(material.opacity * 0.9, 0.05, 1);
  innerMaterial.userData = {
    ...(material.userData || {}),
    baseEmissive: material.emissive.clone(),
    baseEmissiveIntensity: material.emissiveIntensity,
    baseOpacity: innerMaterial.opacity
  };
  glassMaterials.push(innerMaterial);
  glowMaterials.push(innerMaterial);
  applyHeightFog(innerMaterial);
  const inner = new THREE.Mesh(geometry, innerMaterial);
  const thicknessScale = clamp(1 - visuals.glass.thickness * 0.03, 0.75, 0.98);
  inner.scale.set(thicknessScale, thicknessScale, thicknessScale);
  const group = new THREE.Group();
  group.add(outer);
  group.add(inner);
  glassShells.push({ inner, outer });
  return { group, outer, inner };
};

export const configureWireMaterial = (wireMat) => {
  const { visuals, visualDefaults } = state;
  const thickness = numberValue(visuals.wireframeThickness, visualDefaults.wireframeThickness);
  const glow = numberValue(visuals.wireframeGlow, visualDefaults.wireframeGlow);
  const baseColor = wireMat.userData?.baseColor || wireMat.color;
  const emissiveColor = wireMat.userData?.emissiveColor || baseColor;

  // Keep glow usable without overpowering the scene.
  wireMat.opacity = clamp(0.03 + glow * 0.07, 0.03, 0.22);
  if ('linewidth' in wireMat) {
    wireMat.linewidth = clamp(thickness, 0.02, 2.5);
    wireMat.userData.baseLinewidth = wireMat.linewidth;
  }
  wireMat.color.copy(emissiveColor);
  wireMat.userData = wireMat.userData || {};
  wireMat.userData.glowBase = clamp(0.02 + glow * 0.06, 0.02, 0.16);
  wireMat.userData.glowRange = clamp(0.03 + glow * 0.11, 0.03, 0.22);
};

export const createWireframe = (geometry, color, phase) => {
  const {
    THREE,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    lineResolution,
    wireMaterials
  } = state;
  const wireGeom = new THREE.EdgesGeometry(geometry);
  let wireMat;
  if (LineMaterial && LineSegments2 && LineSegmentsGeometry) {
    wireMat = new LineMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      linewidth: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    wireMat.worldUnits = true;
    wireMat.resolution.set(lineResolution.width, lineResolution.height);
  } else {
    wireMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      linewidth: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
  }
  const emissiveColor = color.clone().lerp(new THREE.Color(0xffffff), 0.18);
  wireMat.userData = {
    glowBase: 0.18,
    glowRange: 0.25,
    flowPhase: phase || 0,
    baseColor: color.clone(),
    emissiveColor: emissiveColor.clone()
  };
  configureWireMaterial(wireMat);
  wireMaterials.push(wireMat);
  if (LineSegments2 && LineSegmentsGeometry && wireMat instanceof LineMaterial) {
    const lineGeom = new LineSegmentsGeometry();
    lineGeom.setPositions(wireGeom.attributes.position.array);
    const line = new LineSegments2(lineGeom, wireMat);
    line.computeLineDistances();
    wireGeom.dispose();
    return line;
  }
  return new THREE.LineSegments(wireGeom, wireMat);
};

export const createTextPlane = (text, options = {}) => {
  const { THREE, labelMaterials } = state;
  const size = Number.isFinite(options.size) ? options.size : 0;
  const maxTextureSize = 1024;
  const baseFontSize = Math.max(20, Math.round(220 * (size || 1)));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const measure = (fontPx) => {
    context.font = `600 ${fontPx}px "Segoe UI", sans-serif`;
    const paddingPx = Math.round(fontPx * 0.2);
    const metrics = context.measureText(text);
    const widthPx = Math.ceil(metrics.width + paddingPx * 2);
    const heightPx = Math.ceil(fontPx + paddingPx * 2);
    return { fontPx, paddingPx, widthPx, heightPx };
  };
  let { fontPx, paddingPx, widthPx, heightPx } = measure(baseFontSize);
  const scaleDown = Math.min(1, maxTextureSize / Math.max(widthPx, heightPx));
  if (scaleDown < 1) {
    ({ fontPx, paddingPx, widthPx, heightPx } = measure(Math.max(10, Math.floor(baseFontSize * scaleDown))));
  }
  canvas.width = Math.min(maxTextureSize, widthPx);
  canvas.height = Math.min(maxTextureSize, heightPx);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `600 ${fontPx}px "Segoe UI", sans-serif`;
  context.fillStyle = options.color || '#e7eef8';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.fillText(text, paddingPx, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: options.opacity ?? 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    map: texture
  });
  if ('toneMapped' in material) material.toneMapped = false;
  material.userData = { baseOpacity: material.opacity };
  applyHeightFog(material);
  labelMaterials.push(material);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100), material);
  plane.userData = { labelTexture: texture };
  return plane;
};

export const applyGlassSettings = () => {
  const {
    THREE,
    visuals,
    visualDefaults,
    glassMaterials,
    glassShells,
    normalMapState
  } = state;
  const glass = visuals.glass || visualDefaults.glass;
  const transmission = clamp(glass.transmission ?? 0, 0, 1);
  const tCurve = Math.pow(transmission, 2.2);
  const envScale = 0.35 + 0.65 * tCurve;
  for (const material of glassMaterials) {
    material.metalness = glass.metalness;
    material.roughness = glass.roughness;
    material.transmission = tCurve;
    material.ior = glass.ior;
    material.reflectivity = glass.reflectivity;
    material.thickness = glass.thickness;
    material.attenuationDistance = tCurve > 0 ? (2 + 120 * tCurve) : 0;
    if ('attenuationColor' in material) material.attenuationColor = (material.userData?.baseColor || material.color).clone();
    material.envMapIntensity = glass.envMapIntensity * envScale;
    material.clearcoat = glass.clearcoat;
    material.clearcoatRoughness = glass.clearcoatRoughness;
    if (normalMapState.texture) {
      normalMapState.texture.repeat.set(glass.normalRepeat, glass.normalRepeat);
      material.normalScale = new THREE.Vector2(glass.normalScale, glass.normalScale);
      material.clearcoatNormalScale = new THREE.Vector2(glass.clearcoatNormalScale, glass.clearcoatNormalScale);
    }
    if (material.userData?.fogUniforms) {
      material.userData.fogUniforms.fogHeight.value = visuals.fogHeight;
      material.userData.fogUniforms.fogHeightRange.value = visuals.fogHeightRange;
      if ('fogHeightEnabled' in material.userData.fogUniforms) {
        material.userData.fogUniforms.fogHeightEnabled.value = visuals.enableHeightFog ? 1 : 0;
      }
    }
    material.needsUpdate = true;
  }
  const thicknessScale = clamp(1 - glass.thickness * 0.03, 0.75, 0.98);
  for (const shell of glassShells) {
    if (shell?.inner) shell.inner.scale.set(thicknessScale, thicknessScale, thicknessScale);
  }
};

export const updateFileOpacity = () => {
  const { visuals, visualDefaults, fileMeshes } = state;
  const opacity = clamp(numberValue(visuals.fileOpacity, visualDefaults.fileOpacity), 0.1, 1);
  for (const mesh of fileMeshes) {
    if (mesh.material) {
      mesh.material.opacity = opacity;
      if (mesh.material.userData) mesh.material.userData.baseOpacity = opacity;
    }
    const inner = mesh.userData?.shellInner;
    if (inner?.material) {
      const innerOpacity = clamp(opacity * 0.9, 0.05, 1);
      inner.material.opacity = innerOpacity;
      if (inner.material.userData) inner.material.userData.baseOpacity = innerOpacity;
    }
  }
};

export const updateMemberOpacity = () => {
  const { visuals, visualDefaults, memberMeshes, chunkMeshes, instancedMemberMaterials, instancedChunkMaterial } = state;
  const opacity = clamp(numberValue(visuals.memberOpacity, visualDefaults.memberOpacity), 0.1, 1);

  // Instanced members/chunks use shared materials (huge perf win). Update those directly.
  const instancedMemberMat = instancedMemberMaterials?.member || null;
  if (instancedMemberMat) {
    instancedMemberMat.opacity = opacity;
    instancedMemberMat.userData = instancedMemberMat.userData || {};
    instancedMemberMat.userData.baseOpacity = opacity;
  }
  if (instancedChunkMaterial) {
    const chunkOpacity = clamp(opacity, 0.1, 1);
    instancedChunkMaterial.opacity = chunkOpacity;
    instancedChunkMaterial.userData = instancedChunkMaterial.userData || {};
    instancedChunkMaterial.userData.baseOpacity = chunkOpacity;
  }

  // Legacy (non-instanced) meshes still get updated for compatibility.
  for (const mesh of [...(memberMeshes || []), ...(chunkMeshes || [])]) {
    if (!mesh) continue;
    if (mesh.material) {
      mesh.material.opacity = opacity;
      if (mesh.material.userData) mesh.material.userData.baseOpacity = opacity;
    }
    const inner = mesh.userData?.shellInner;
    if (inner?.material) {
      const innerOpacity = clamp(opacity * 0.9, 0.05, 1);
      inner.material.opacity = innerOpacity;
      if (inner.material.userData) inner.material.userData.baseOpacity = innerOpacity;
    }
  }
};

export const updateWireframes = () => {
  const { wireMaterials, lineResolution } = state;
  for (const material of wireMaterials) {
    configureWireMaterial(material);
    if (material.resolution && typeof material.resolution.set === 'function') {
      material.resolution.set(lineResolution.width, lineResolution.height);
    }
    material.needsUpdate = true;
  }
};

export const updateFlowGlow = () => {
  const { flowMaterials, visuals } = state;
  for (const material of flowMaterials) {
    material.emissiveIntensity = visuals.flowGlowBase;
    material.userData.glowBase = visuals.flowGlowBase;
    material.userData.glowRange = visuals.flowGlowRange;
    material.userData.baseEmissiveIntensity = visuals.flowGlowBase;
  }
};

export const updateGridGlow = () => {
  const { visuals, visualDefaults, gridLineMaterials, lineResolution } = state;
  const base = numberValue(visuals.gridGlowBase, visualDefaults.gridGlowBase);
  const range = numberValue(visuals.gridGlowRange, visualDefaults.gridGlowRange);
  const thickness = numberValue(visuals.gridLineThickness, visualDefaults.gridLineThickness);
  for (const material of gridLineMaterials) {
    material.opacity = clamp(base + range * 0.5, 0.05, 0.9);
    material.userData.glowBase = base;
    material.userData.glowRange = range;
    material.userData.flowSpeed = numberValue(visuals.gridPulseSpeed, visualDefaults.gridPulseSpeed);
    if ('linewidth' in material) {
      material.linewidth = clamp(thickness, 0.02, 6);
    }
    if (material.resolution && typeof material.resolution.set === 'function') {
      material.resolution.set(lineResolution.width, lineResolution.height);
    }
  }
};

export const updateFog = (maxSpanOverride) => {
  const {
    fogBounds,
    visuals,
    visualDefaults,
    scene,
    THREE,
    glassMaterials,
    labelMaterials,
    flowMaterials,
    wireMaterials,
    gridLineMaterials,
    grid
  } = state;
  if (Number.isFinite(maxSpanOverride)) {
    fogBounds.maxSpan = maxSpanOverride;
  }
  const maxSpan = fogBounds.maxSpan || 120;
  if (!visuals.enableFog) {
    scene.fog = null;
    return;
  }
  const colorValue = visuals.fogColor || visualDefaults.fogColor;
  const fogColor = new THREE.Color(colorValue);
  const distance = numberValue(visuals.fogDistance, visualDefaults.fogDistance);
  const fogNear = maxSpan * 0.9;
  const fogFar = maxSpan * Math.max(1.1, distance);
  scene.fog = new THREE.Fog(fogColor.getHex(), fogNear, fogFar);
  const updateFogUniforms = (material) => {
    if (!material?.userData?.fogUniforms) return;
    material.userData.fogUniforms.fogHeight.value = visuals.fogHeight;
    material.userData.fogUniforms.fogHeightRange.value = visuals.fogHeightRange;
    if ('fogHeightEnabled' in material.userData.fogUniforms) {
      material.userData.fogUniforms.fogHeightEnabled.value = visuals.enableHeightFog ? 1 : 0;
    }
  };
  [...glassMaterials, ...labelMaterials, ...flowMaterials, ...wireMaterials, ...gridLineMaterials]
    .forEach(updateFogUniforms);
  if (grid?.material) updateFogUniforms(grid.material);
};

export const updateFlowLights = () => {
  const { visuals, flowLights } = state;
  const enabled = visuals.enableFlowLights !== false;
  for (const light of flowLights) {
    light.visible = enabled;
  }
};

export const updateExtraLights = () => {
  const { visuals, extraLights } = state;
  const enabled = visuals.enableExtraLights !== false;
  for (const light of extraLights) {
    light.visible = enabled;
  }
};