import { state } from './state.js';
import { clamp, hashString } from './utils.js';
import { createGlassMaterial, createGlassShell, createTextPlane, createWireframe } from './materials.js';
import { createShapeGeometry } from './layout.js';

const colorPalette = {
  source: 0x2980b9,
  test: 0x8e44ad,
  config: 0x16a085,
  docs: 0xd35400,
  generated: 0x7f8c8d,
  dir: 0x34495e,
  other: 0x2c3e50
};

export const buildMeshes = () => {
  const {
    THREE,
    visuals,
    allFiles,
    layoutMetrics,
    fileGroup,
    memberGroup,
    labelGroup,
    wireGroup
  } = state;

  const { labelOffset, memberCell } = layoutMetrics;
  const labelsEnabled = Boolean(labelGroup?.visible);
  const chunkInstances = [];
  const fileChunkInstances = [];

  const colorFromKey = (value, saturation = 0.65, lightness = 0.55) => {
    if (!value) return null;
    const seed = hashString(value);
    const hue = (seed % 360) / 360;
    return new THREE.Color().setHSL(hue, saturation, lightness);
  };

  for (const fileLayout of allFiles) {
    const node = fileLayout.node;
    const geometry = createShapeGeometry(fileLayout.shape);
    const languageKey = node.language || node.type || node.ext || node.category || node.name;
    const fileColor = colorFromKey(languageKey, 0.68, 0.52)
      || new THREE.Color(colorPalette[node.category] || colorPalette.other);
    const fileOpacity = Math.max(0.1, Math.min(1, visuals.fileOpacity));
    const material = createGlassMaterial(fileColor, fileOpacity);
    const shell = createGlassShell(geometry, material);
    const mesh = shell.outer;
    shell.group.position.set(fileLayout.x, fileLayout.height / 2, fileLayout.z);
    shell.group.scale.set(fileLayout.width, fileLayout.height, fileLayout.depth);
    const fileTopY = Number.isFinite(fileLayout.topY) ? fileLayout.topY : fileLayout.height;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      type: 'file',
      file: node.path || node.name,
      name: node.name,
      id: node.id || null,
      range: null,
      baseColor: fileColor.clone(),
      shellInner: shell.inner,
      shellGroup: shell.group
    };
    fileGroup.add(shell.group);
    state.fileMeshes.push(mesh);
    state.glowMaterials.push(material);
    const fileWireColor = fileColor.clone();
    const fileWire = createWireframe(geometry, fileWireColor, shell.group.position.x + shell.group.position.z);
    fileWire.position.copy(shell.group.position);
    fileWire.rotation.copy(shell.group.rotation);
    fileWire.scale.copy(shell.group.scale);
    wireGroup.add(fileWire);
    state.wireByMesh.set(mesh, fileWire);
    const fileKey = node.path || node.name;
    if (fileKey) {
      state.fileAnchors.set(fileKey, { x: shell.group.position.x, y: fileTopY, z: shell.group.position.z });
      state.fileColorByPath.set(fileKey, fileColor.clone());
      state.fileMeshByKey.set(fileKey, mesh);
    }

    const fileChunkCount = clamp(Math.ceil(Math.sqrt(fileLayout.members.length || 1)), 1, 8);
    if (fileChunkCount > 0) {
      const innerWidth = fileLayout.width * 0.6;
      const innerDepth = fileLayout.depth * 0.6;
      const cols = Math.max(1, Math.ceil(Math.sqrt(fileChunkCount)));
      const rows = Math.max(1, Math.ceil(fileChunkCount / cols));
      const stepX = innerWidth / cols;
      const stepZ = innerDepth / rows;
      const startX = fileLayout.x - innerWidth / 2 + stepX / 2;
      const startZ = fileLayout.z - innerDepth / 2 + stepZ / 2;
      for (let i = 0; i < fileChunkCount; i += 1) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const seed = hashString(`${fileKey || node.name || 'file'}:${i}`);
        const t = (seed % 1000) / 1000;
        const heightScale = 0.6 + t * 0.6;
        const footprintScale = 0.45 + ((seed >> 6) % 100) / 250;
        const chunkHeight = Math.max(0.12, fileLayout.height * 0.08 * heightScale);
        const chunkFootprint = Math.min(stepX, stepZ) * footprintScale;
        const innerBottom = fileLayout.height * 0.12;
        const innerTop = fileLayout.height * 0.65;
        const centerY = Math.min(
          innerTop - chunkHeight / 2,
          innerBottom + (innerTop - innerBottom) * t
        );
        const chunkColor = fileColor.clone().offsetHSL(0.05 * t, 0.08, 0.08);
        fileChunkInstances.push({
          x: startX + col * stepX,
          y: centerY,
          z: startZ + row * stepZ,
          scaleX: chunkFootprint,
          scaleY: chunkHeight,
          scaleZ: chunkFootprint,
          color: chunkColor
        });
      }
    }

    const fileLabelText = String(node.name || node.path || '').split('/').filter(Boolean).pop();
    if (labelsEnabled && fileLabelText) {
      const fileLabelSize = Math.min(fileLayout.width, fileLayout.depth);
      const fileLabel = createTextPlane(fileLabelText, { size: fileLabelSize });
      if (fileLabel.material) fileLabel.material.depthTest = true;
      fileLabel.position.set(
        shell.group.position.x + fileLayout.width * 0.5 + labelOffset,
        Math.max(0.3, fileTopY * 0.6),
        shell.group.position.z + fileLayout.depth * 0.5 + labelOffset
      );
      fileLabel.rotation.y = -Math.PI / 4;
      fileLabel.renderOrder = 4;
      labelGroup.add(fileLabel);
    }

    const slots = fileLayout.memberSlots;
    if (!slots.length) continue;
    const members = fileLayout.members.slice().sort((a, b) => {
      const footprintDiff = (b.footprint || 0) - (a.footprint || 0);
      if (footprintDiff !== 0) return footprintDiff;
      return (b.height || 0) - (a.height || 0);
    });
    const slotStep = fileLayout.slotStep || (layoutMetrics.memberCell + layoutMetrics.memberGap);
    const slotLimit = Math.max(0.2, slotStep - layoutMetrics.memberGap * 0.6);
    const maxFootprint = Math.min(
      (fileLayout.surfaceWidth || fileLayout.width) / Math.max(1, fileLayout.columns || 1),
      (fileLayout.surfaceDepth || fileLayout.depth) / Math.max(1, fileLayout.rows || 1),
      slotLimit
    ) - layoutMetrics.memberGap;
    members.forEach((entry, index) => {
      const slot = slots[index];
      if (!slot) return;
      const height = entry.height;
      const rawFootprint = entry.footprint || memberCell;
      const footprint = Math.max(0.2, Math.min(rawFootprint, maxFootprint || rawFootprint));
      const mGeom = createShapeGeometry(entry.shape);
      const memberKey = entry.member.id || entry.member.name || entry.member.file || '';
      const mColor = state.scoreToColor(entry.score, memberKey);
      if (entry.member.id) state.memberColorById.set(entry.member.id, mColor.clone());
      const memberOpacity = Math.max(0.1, Math.min(1, visuals.memberOpacity));
      const mMat = createGlassMaterial(mColor, memberOpacity);
      const shellMember = createGlassShell(mGeom, mMat);
      const mMesh = shellMember.outer;
      const anchorY = Number.isFinite(fileLayout.topY) ? fileLayout.topY : fileLayout.height;
      const lift = Math.max(0.06, layoutMetrics.memberGap * 0.35);
      shellMember.group.position.set(fileLayout.x + slot.x, anchorY + height / 2 + lift, fileLayout.z + slot.z);
      shellMember.group.scale.set(footprint, height, footprint);
      mMesh.castShadow = false;
      mMesh.receiveShadow = false;
      mMesh.userData = {
        type: 'member',
        file: node.path || node.name,
        id: entry.member.id || null,
        name: entry.member.name,
        range: entry.member.range || null,
        baseColor: mColor.clone(),
        shellInner: shellMember.inner,
        shellGroup: shellMember.group
      };
      memberGroup.add(shellMember.group);
      state.memberMeshes.push(mMesh);
      state.glowMaterials.push(mMat);
      const memberWireColor = mColor.clone();
      const memberWire = createWireframe(
        mGeom,
        memberWireColor,
        shellMember.group.position.x + shellMember.group.position.z
      );
      memberWire.position.copy(shellMember.group.position);
      memberWire.rotation.copy(shellMember.group.rotation);
      memberWire.scale.copy(shellMember.group.scale);
      wireGroup.add(memberWire);
      state.wireByMesh.set(mMesh, memberWire);
      if (entry.member.id) {
        state.memberAnchors.set(entry.member.id, {
          x: shellMember.group.position.x,
          y: shellMember.group.position.y + height / 2,
          z: shellMember.group.position.z
        });
        state.memberMeshById.set(entry.member.id, mMesh);
      }
      if (labelsEnabled && entry.member.name) {
        const memberLabelSize = Math.min(footprint, height);
        const memberLabel = createTextPlane(entry.member.name, { size: memberLabelSize });
        if (memberLabel.material) memberLabel.material.depthTest = true;
        memberLabel.position.set(
          shellMember.group.position.x + footprint * 0.5 + labelOffset,
          shellMember.group.position.y,
          shellMember.group.position.z + footprint * 0.5 + labelOffset
        );
        memberLabel.rotation.y = -Math.PI / 4;
        memberLabel.renderOrder = 4;
        labelGroup.add(memberLabel);
      }

      const dataflow = entry.member.dataflow || {};
      const controlFlow = entry.member.controlFlow || {};
      const flowCount = [
        dataflow.reads,
        dataflow.writes,
        dataflow.mutations,
        dataflow.aliases
      ].reduce((acc, value) => acc + (Array.isArray(value) ? value.length : 0), 0);
      const controlCount = Object.values(controlFlow).reduce((acc, value) => {
        if (Array.isArray(value)) return acc + value.length;
        if (typeof value === 'number') return acc + value;
        if (value) return acc + 1;
        return acc;
      }, 0);
      const chunkCount = clamp(Math.ceil(Math.sqrt(flowCount + controlCount + 1)), 1, 6);
      const footprintScale = footprint / memberCell;
      let chunkHeight = Math.max(0.08, height * clamp(0.1 + footprintScale * 0.02, 0.1, 0.18));
      const chunkFootprintScale = clamp(0.55 + footprintScale * 0.15, 0.6, 0.95);
      const chunkFootprint = Math.min(footprint, footprint * chunkFootprintScale);
      let chunkGap = Math.max(0.02, chunkHeight * 0.12);
      const maxStackHeight = height * 0.55;
      const stackHeight = chunkCount * chunkHeight + (chunkCount - 1) * chunkGap;
      if (stackHeight > maxStackHeight && stackHeight > 0) {
        const scale = maxStackHeight / stackHeight;
        chunkHeight *= scale;
        chunkGap *= scale;
      }
      const topY = shellMember.group.position.y + height / 2 - 0.04;
      const chunkStart = topY - (chunkCount * chunkHeight + (chunkCount - 1) * chunkGap) + chunkHeight / 2;
      for (let i = 0; i < chunkCount; i += 1) {
        const chunkY = chunkStart + i * (chunkHeight + chunkGap);
        const chunkColor = mColor.clone().offsetHSL(0.02 * i, 0.08, 0.08);
        chunkInstances.push({
          x: shellMember.group.position.x,
          y: chunkY,
          z: shellMember.group.position.z,
          scaleX: chunkFootprint,
          scaleY: chunkHeight,
          scaleZ: chunkFootprint,
          color: chunkColor
        });
      }
    });
  }

  if (chunkInstances.length) {
    const chunkGeometry = createShapeGeometry('square');
    const chunkOpacity = Math.min(1, Math.max(0.1, visuals.memberOpacity) + 0.1);
    const chunkMaterial = createGlassMaterial(new THREE.Color(0xffffff), chunkOpacity);
    chunkMaterial.vertexColors = true;
    chunkMaterial.userData.glowSpeed = 1.4;
    chunkMaterial.userData.glowPhase = -0.6;
    const prevCompile = chunkMaterial.onBeforeCompile;
    chunkMaterial.onBeforeCompile = (shader) => {
      if (typeof prevCompile === 'function') prevCompile(shader);
      if (shader.fragmentShader.includes('vColor')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor;'
        );
      }
    };
    chunkMaterial.needsUpdate = true;
    const chunkMesh = new THREE.InstancedMesh(chunkGeometry, chunkMaterial, chunkInstances.length);
    chunkMesh.castShadow = false;
    chunkMesh.receiveShadow = false;
    const dummy = new THREE.Object3D();
    chunkInstances.forEach((entry, index) => {
      dummy.position.set(entry.x, entry.y, entry.z);
      dummy.scale.set(entry.scaleX, entry.scaleY, entry.scaleZ);
      dummy.updateMatrix();
      chunkMesh.setMatrixAt(index, dummy.matrix);
      chunkMesh.setColorAt(index, entry.color);
    });
    chunkMesh.instanceMatrix.needsUpdate = true;
    if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
    chunkMesh.userData = { type: 'chunk', opacityOffset: 0.1 };
    memberGroup.add(chunkMesh);
    state.chunkMeshes.push(chunkMesh);
  }

  if (fileChunkInstances.length) {
    const chunkGeometry = createShapeGeometry('square');
    const chunkOpacity = Math.min(1, Math.max(0.1, visuals.fileOpacity) + 0.05);
    const chunkMaterial = createGlassMaterial(new THREE.Color(0xffffff), chunkOpacity);
    chunkMaterial.vertexColors = true;
    chunkMaterial.userData.glowSpeed = 0.6;
    chunkMaterial.userData.glowPhase = Math.PI * 0.3;
    const prevCompile = chunkMaterial.onBeforeCompile;
    chunkMaterial.onBeforeCompile = (shader) => {
      if (typeof prevCompile === 'function') prevCompile(shader);
      if (shader.fragmentShader.includes('vColor')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor;'
        );
      }
    };
    chunkMaterial.needsUpdate = true;
    const chunkMesh = new THREE.InstancedMesh(chunkGeometry, chunkMaterial, fileChunkInstances.length);
    const dummy = new THREE.Object3D();
    fileChunkInstances.forEach((entry, index) => {
      dummy.position.set(entry.x, entry.y, entry.z);
      dummy.scale.set(entry.scaleX, entry.scaleY, entry.scaleZ);
      dummy.updateMatrix();
      chunkMesh.setMatrixAt(index, dummy.matrix);
      chunkMesh.setColorAt(index, entry.color);
    });
    chunkMesh.instanceMatrix.needsUpdate = true;
    if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
    chunkMesh.userData = { type: 'file-chunk', opacityOffset: 0.05 };
    fileGroup.add(chunkMesh);
    state.fileChunkMeshes.push(chunkMesh);
  }
};
