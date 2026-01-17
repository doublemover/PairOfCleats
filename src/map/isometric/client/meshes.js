import { state } from './state.js';
import { clamp } from './utils.js';
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

const countMemberFlows = (member) => {
  const dataflow = member?.dataflow || {};
  const controlFlow = member?.controlFlow || {};
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

  return { flowCount, controlCount };
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

  const { labelOffset, memberCell, memberGap } = layoutMetrics;
  const labelsEnabled = Boolean(labelGroup?.visible);
  const enableShadows = visuals.enableShadows === true;

  const fileOpacity = clamp(Number(visuals.fileOpacity ?? 1), 0.1, 1);
  const memberOpacity = clamp(Number(visuals.memberOpacity ?? 1), 0.1, 1);

  // Shared instanced materials. These dramatically reduce material count and per-frame glow updates.
  const white = new THREE.Color(0xffffff);
  const memberInstancedMaterial = createGlassMaterial(white, memberOpacity);
  memberInstancedMaterial.vertexColors = true;
  memberInstancedMaterial.side = THREE.DoubleSide;
  memberInstancedMaterial.userData = { ...(memberInstancedMaterial.userData || {}), role: 'member-instanced' };

  // Chunks track member opacity (they are content elements, not the file shell).
  const chunkOpacity = clamp(memberOpacity, 0.15, 1);
  const chunkInstancedMaterial = createGlassMaterial(white, chunkOpacity);
  chunkInstancedMaterial.vertexColors = true;
  chunkInstancedMaterial.side = THREE.DoubleSide;
  chunkInstancedMaterial.userData = { ...(chunkInstancedMaterial.userData || {}), role: 'chunk-instanced' };

  state.instancedMemberMaterials = { member: memberInstancedMaterial };
  state.instancedChunkMaterial = chunkInstancedMaterial;

  const dummy = new THREE.Object3D();
  const identityRotation = new THREE.Euler(0, 0, 0);

  for (const fileLayout of allFiles) {
    const node = fileLayout.node;
    const fileKey = node.path || node.name;

    const fileGeom = createShapeGeometry(fileLayout.shape);
    const fileColorHex = colorPalette[node.category] || colorPalette.other;
    const fileColor = new THREE.Color(fileColorHex);

    const fileMat = createGlassMaterial(fileColor, fileOpacity);
    const fileShell = createGlassShell(fileGeom, fileMat);

    fileShell.group.position.set(fileLayout.x, fileLayout.height / 2, fileLayout.z);
    fileShell.group.scale.set(fileLayout.width, fileLayout.height, fileLayout.depth);

    const fileTopY = Number.isFinite(fileLayout.topY) ? fileLayout.topY : fileLayout.height;

    // Render order: keep the file glass below members and wireframes.
    if (fileShell.inner) fileShell.inner.renderOrder = 2;
    fileShell.outer.renderOrder = 3;

    fileShell.outer.castShadow = enableShadows;
    fileShell.outer.receiveShadow = enableShadows;
    if (fileShell.inner) {
      fileShell.inner.castShadow = enableShadows;
      fileShell.inner.receiveShadow = enableShadows;
    }

    fileShell.outer.userData = {
      type: 'file',
      file: fileKey,
      name: node.name,
      id: node.id || null,
      range: null,
      baseColor: fileColor.clone(),
      shellInner: fileShell.inner,
      shellGroup: fileShell.group
    };

    fileGroup.add(fileShell.group);
    state.fileMeshes.push(fileShell.outer);

    const fileWire = createWireframe(fileGeom, fileColor.clone(), fileShell.group.position.x + fileShell.group.position.z);
    fileWire.position.copy(fileShell.group.position);
    fileWire.rotation.copy(fileShell.group.rotation);
    fileWire.scale.copy(fileShell.group.scale);
    fileWire.renderOrder = 6;
    wireGroup.add(fileWire);
    state.wireByMesh.set(fileShell.outer, fileWire);

    if (fileKey) {
      state.fileAnchors.set(fileKey, { x: fileShell.group.position.x, y: fileTopY, z: fileShell.group.position.z });
      state.fileColorByPath.set(fileKey, fileColor.clone());
      state.fileMeshByKey.set(fileKey, fileShell.outer);
    }

    const fileLabelText = String(node.name || node.path || '').split('/').filter(Boolean).pop();
    if (labelsEnabled && fileLabelText) {
      const fileLabelSize = Math.min(fileLayout.width, fileLayout.depth);
      const fileLabel = createTextPlane(fileLabelText, { size: fileLabelSize });
      if (fileLabel.material) fileLabel.material.depthTest = true;
      fileLabel.position.set(
        fileShell.group.position.x + fileLayout.width * 0.5 + labelOffset,
        fileTopY,
        fileShell.group.position.z + fileLayout.depth * 0.5 + labelOffset
      );
      fileLabel.rotation.y = -Math.PI / 4;
      fileLabel.renderOrder = 7;
      labelGroup.add(fileLabel);
    }

    const slots = fileLayout.memberSlots || [];
    const members = (fileLayout.members || []).slice().sort((a, b) => b.height - a.height);

    const maxFootprint = Math.min(
      (fileLayout.surfaceWidth || fileLayout.width) / Math.max(1, fileLayout.columns || 1),
      (fileLayout.surfaceDepth || fileLayout.depth) / Math.max(1, fileLayout.rows || 1)
    ) - memberGap;

    // --- Members rendered via GPU instancing (clustered per file and per shape) ---
    if (members.length && slots.length) {
      const anchorY = fileTopY;

      const placed = [];
      for (let index = 0; index < members.length; index += 1) {
        const entry = members[index];
        const slot = slots[index];
        if (!slot) continue;

        const height = entry.height;
        const rawFootprint = entry.footprint || memberCell;
        const footprint = Math.max(0.2, Math.min(rawFootprint, maxFootprint || rawFootprint));

        const rawMemberId = entry.member.id;
        const memberId = rawMemberId === 0 || rawMemberId ? String(rawMemberId) : null;
        const memberKey = memberId || entry.member.name || entry.member.file || '';
        const mColor = state.scoreToColor(entry.score, memberKey);
        if (memberId) state.memberColorById.set(memberId, mColor.clone());

        placed.push({ entry, slot, height, footprint, color: mColor, memberId });
      }

      if (placed.length) {
        const cluster = new THREE.Group();
        cluster.position.set(fileLayout.x, 0, fileLayout.z);
        cluster.userData = { type: 'memberCluster', file: fileKey };
        memberGroup.add(cluster);

        const maxMemberHeight = members[0]?.height || 0;
        const maxY = anchorY + maxMemberHeight + 0.05;
        const centerY = maxY * 0.5;
        const halfX = fileLayout.width * 0.5;
        const halfZ = fileLayout.depth * 0.5;
        const radius = Math.sqrt(halfX * halfX + halfZ * halfZ + centerY * centerY);
        state.memberClusters.push({
          group: cluster,
          sphere: new THREE.Sphere(new THREE.Vector3(fileLayout.x, centerY, fileLayout.z), radius)
        });

        const buckets = new Map();
        for (const item of placed) {
          const shape = item.entry.shape || 'square';
          const bucket = buckets.get(shape) || [];
          bucket.push(item);
          buckets.set(shape, bucket);
        }

        for (const [shape, bucket] of buckets.entries()) {
          const count = bucket.length;
          if (!count) continue;

          const mGeom = createShapeGeometry(shape);
          const instanced = new THREE.InstancedMesh(mGeom, memberInstancedMaterial, count);
          instanced.castShadow = enableShadows;
          instanced.receiveShadow = enableShadows;
          instanced.renderOrder = 4;
          instanced.userData = {
            type: 'memberInstances',
            file: fileKey,
            shape,
            instanceInfo: new Array(count)
          };

          cluster.add(instanced);
          state.memberInstancedMeshes.push(instanced);

          for (let i = 0; i < bucket.length; i += 1) {
            const item = bucket[i];
            const { entry, slot, height, footprint, color, memberId } = item;

            const localX = slot.x;
            const localZ = slot.z;
            const localY = anchorY + height / 2 + 0.05;

            dummy.position.set(localX, localY, localZ);
            dummy.rotation.copy(identityRotation);
            dummy.scale.set(footprint, height, footprint);
            dummy.updateMatrix();

            instanced.setMatrixAt(i, dummy.matrix);
            instanced.setColorAt(i, color);

            const worldX = fileLayout.x + localX;
            const worldZ = fileLayout.z + localZ;
            const worldY = localY;

            instanced.userData.instanceInfo[i] = {
              type: 'member',
              file: fileKey,
              id: memberId,
              name: entry.member.name,
              range: entry.member.range || null,
              baseColor: color.clone(),
              shape,
              x: worldX,
              y: worldY,
              z: worldZ,
              footprint,
              height
            };

            if (memberId) {
              state.memberInstanceById.set(memberId, { mesh: instanced, instanceId: i });
              state.memberAnchors.set(memberId, {
                x: worldX,
                y: anchorY + height + 0.05,
                z: worldZ
              });
            }

            if (labelsEnabled && entry.member.name) {
              const memberLabelSize = Math.min(footprint, height);
              const memberLabel = createTextPlane(entry.member.name, { size: memberLabelSize });
              if (memberLabel.material) memberLabel.material.depthTest = true;
              memberLabel.position.set(
                worldX + footprint * 0.6 + labelOffset,
                worldY + height * 0.5,
                worldZ + footprint * 0.6 + labelOffset
              );
              memberLabel.rotation.y = -Math.PI / 4;
              memberLabel.renderOrder = 7;
              labelGroup.add(memberLabel);
            }
          }

          instanced.instanceMatrix.needsUpdate = true;
          if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
          if (typeof instanced.computeBoundingSphere === 'function') instanced.computeBoundingSphere();
          if (typeof instanced.computeBoundingBox === 'function') instanced.computeBoundingBox();
        }
      }
    }

    // --- File chunks (content) rendered inside the file volume (instanced per file) ---
    let flowTotal = 0;
    let controlTotal = 0;
    for (const entry of members) {
      const counts = countMemberFlows(entry.member);
      flowTotal += counts.flowCount;
      controlTotal += counts.controlCount;
    }

    const complexity = flowTotal + controlTotal + members.length * 0.5;
    const chunkCount = clamp(Math.ceil(Math.sqrt(complexity + 1)), 0, 18);

    if (chunkCount > 0) {
      const inset = Math.min(fileLayout.width, fileLayout.depth) * 0.18;
      const innerW = Math.max(0.3, fileLayout.width - inset * 2);
      const innerD = Math.max(0.3, fileLayout.depth - inset * 2);

      const cols = Math.max(1, Math.ceil(Math.sqrt(chunkCount)));
      const rows = Math.max(1, Math.ceil(chunkCount / cols));
      const cellW = innerW / cols;
      const cellD = innerD / rows;

      const cubeSize = Math.min(cellW, cellD) * 0.62;
      const cubeH = Math.min(cubeSize, fileLayout.height * 0.12);
      const baseY = Math.max(0.12, fileLayout.height * 0.16) + cubeH / 2;

      const chunkGeom = createShapeGeometry('square');
      const chunkMesh = new THREE.InstancedMesh(chunkGeom, chunkInstancedMaterial, chunkCount);
      chunkMesh.position.set(fileLayout.x, 0, fileLayout.z);
      chunkMesh.renderOrder = 2;
      chunkMesh.castShadow = enableShadows;
      chunkMesh.receiveShadow = enableShadows;
      chunkMesh.userData = { type: 'chunkInstances', file: fileKey };

      const startX = -innerW / 2 + cellW / 2;
      const startZ = -innerD / 2 + cellD / 2;

      for (let i = 0; i < chunkCount; i += 1) {
        const col = i % cols;
        const row = Math.floor(i / cols);

        const localX = startX + col * cellW;
        const localZ = startZ + row * cellD;
        const y = baseY + (((col + row) % 2) * cubeH * 0.12);

        dummy.position.set(localX, y, localZ);
        dummy.rotation.copy(identityRotation);
        dummy.scale.set(cubeSize, cubeH, cubeSize);
        dummy.updateMatrix();

        const chunkColor = fileColor.clone().lerp(white, 0.12).offsetHSL(0.015 * i, 0.05, 0.04);

        chunkMesh.setMatrixAt(i, dummy.matrix);
        chunkMesh.setColorAt(i, chunkColor);
      }

      chunkMesh.instanceMatrix.needsUpdate = true;
      if (chunkMesh.instanceColor) chunkMesh.instanceColor.needsUpdate = true;
      if (typeof chunkMesh.computeBoundingSphere === 'function') chunkMesh.computeBoundingSphere();
      if (typeof chunkMesh.computeBoundingBox === 'function') chunkMesh.computeBoundingBox();

      fileGroup.add(chunkMesh);
      state.chunkMeshes.push(chunkMesh);
    }
  }
};
