import { state } from './state.js';
import { clamp, numberValue } from './utils.js';
import { toArray } from '../../../shared/iterables.js';
import { applyHighlights, setSelection, openSelection } from './selection.js';
import { applyBucketCulling, applyEdgeCulling, forceBucketVisible } from './culling.js';
import { resolveLodTier, applyLodTier } from './lod.js';
import { updatePerfStats } from './telemetry.js';

export const initControls = () => {
  const {
    THREE,
    dom,
    renderer,
    camera,
    lockIsometric,
    getViewport,
    groundPlane,
    lineResolution,
    controlDefaults,
    controls,
    flowWaveLayers,
    flowWaveTotal,
    visuals,
    visualDefaults
  } = state;

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const zoomRaycaster = new THREE.Raycaster();

  const fillPickTargets = () => {
    const targets = state.pickTargets || (state.pickTargets = []);
    targets.length = 0;

    const fileVisible = state.fileGroup?.visible !== false;
    const memberVisible = state.memberGroup?.visible !== false;

    if (fileVisible) {
      targets.push(...toArray(state.fileInstancedMeshes));
      targets.push(...toArray(state.fileMeshes));
    }

    if (memberVisible) {
      for (const mesh of toArray(state.memberInstancedMeshes)) {
        // Cluster culling toggles parent visibility.
        if (mesh?.parent?.visible !== false) targets.push(mesh);
      }
      // Legacy (non-instanced) members.
      targets.push(...toArray(state.memberMeshes));
    }

    return targets;
  };

  // Cluster / frustum culling for member instances (updates group.visible in batches).
  const cullFrustum = new THREE.Frustum();
  const cullMatrix = new THREE.Matrix4();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let cullTimer = 0;
  const cullInterval = Number.isFinite(state.performance?.cullInterval)
    ? state.performance.cullInterval
    : 0.08;

  const updateMemberCulling = () => {
    if (!state.memberClusters || !state.memberClusters.length) return;
    if (state.memberGroup?.visible === false) return;
    cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullFrustum.setFromProjectionMatrix(cullMatrix);

    for (const cluster of state.memberClusters) {
      if (!cluster?.group || !cluster?.sphere) continue;
      cluster.group.visible = cullFrustum.intersectsSphere(cluster.sphere);
    }

    const selected = state.selectedInfo;
    const selectedId = selected?.type === 'member' && selected.id ? String(selected.id) : null;
    if (selectedId && state.memberClusterByMemberId?.has(selectedId)) {
      const target = state.memberClusterByMemberId.get(selectedId);
      if (target?.group) target.group.visible = true;
    }
  };

  const updateFileCulling = () => {
    if (!state.fileBuckets || !state.fileBuckets.length) return;
    if (state.fileGroup?.visible === false) return;
    cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullFrustum.setFromProjectionMatrix(cullMatrix);
    applyBucketCulling({ frustum: cullFrustum, buckets: state.fileBuckets, hiddenMatrix });

    const selected = state.selectedInfo;
    const fileKey = selected?.type === 'file' ? (selected.file || selected.name) : null;
    if (fileKey && state.fileBucketByKey?.has(fileKey)) {
      const bucket = state.fileBucketByKey.get(fileKey);
      forceBucketVisible(bucket);
    }
  };

  const updateEdgeCulling = () => {
    const targets = toArray(state.edgeCullingTargets);
    if (!targets.length) return;
    cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cullFrustum.setFromProjectionMatrix(cullMatrix);
    applyEdgeCulling({ frustum: cullFrustum, targets });
  };


  const getPointerNdc = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return { x, y, rect };
  };

  const getPlanePointFromNdc = (ndc) => {
    if (!ndc) return null;
    zoomRaycaster.setFromCamera({ x: ndc.x, y: ndc.y }, camera);
    const point = new THREE.Vector3();
    if (zoomRaycaster.ray.intersectPlane(groundPlane, point)) return point;
    return null;
  };

  const onPointer = (event) => {
    const ndc = getPointerNdc(event);
    pointer.x = ndc.x;
    pointer.y = ndc.y;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects(fillPickTargets(), false);
    setSelection(hits.length ? hits[0] : null);
  };

  let dragging = false;
  let dragMoved = false;
  let lastPointer = { x: 0, y: 0 };

  const startDrag = (event) => {
    dragging = true;
    dragMoved = false;
    lastPointer = { x: event.clientX, y: event.clientY };
  };

  const moveDrag = (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) dragMoved = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    const ndc = getPointerNdc(event);
    const rect = ndc.rect;
    if (!rect.width || !rect.height) return;
    const viewWidth = (camera.right - camera.left) / camera.zoom;
    const viewHeight = (camera.top - camera.bottom) / camera.zoom;
    const unitsX = viewWidth / rect.width;
    const unitsZ = viewHeight / rect.height;
    const panSensitivity = controls.panSensitivity || controlDefaults.panSensitivity;
    const rot = Math.PI / 4;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const dragForward = -dy;
    const dragSide = dx;
    const moveX = (dragForward * cos - dragSide * sin) * unitsX * panSensitivity;
    const moveZ = (dragForward * sin + dragSide * cos) * unitsZ * panSensitivity;
    camera.position.x += moveX;
    camera.position.z += moveZ;
    lockIsometric();
  };

  const updateHover = (event) => {
    if (dragging) return;
    const ndc = getPointerNdc(event);
    pointer.x = ndc.x;
    pointer.y = ndc.y;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(fillPickTargets(), false);
    const nextHover = hits.length ? hits[0] : null;
    const prev = state.hovered;
    const same =
      (prev === null && nextHover === null) ||
      (prev && nextHover && prev.object === nextHover.object && prev.instanceId === nextHover.instanceId);

    if (!same) {
      state.hovered = nextHover;
      applyHighlights();
    }
  };

  const endDrag = () => {
    dragging = false;
  };

  renderer.domElement.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointerleave', endDrag);
  renderer.domElement.addEventListener('pointermove', updateHover);
  renderer.domElement.addEventListener('pointerleave', () => {
    state.hovered = null;
    applyHighlights();
  });

  renderer.domElement.addEventListener('click', (event) => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    onPointer(event);
  });
  renderer.domElement.addEventListener('dblclick', (event) => {
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    onPointer(event);
    openSelection();
  });

  let focused = false;
  dom.app.addEventListener('pointerdown', () => {
    focused = true;
    dom.app.focus();
  });
  window.addEventListener('blur', () => { focused = false; });

  const keys = {};
  window.addEventListener('keydown', (event) => {
    if (!focused) return;
    keys[event.code] = true;
  });
  window.addEventListener('keyup', (event) => {
    if (!focused) return;
    keys[event.code] = false;
  });

  const velocity = new THREE.Vector2(0, 0);

  const updateCamera = (dt) => {
    const wasd = controls.wasd || controlDefaults.wasd;
    const accel = wasd.acceleration || controlDefaults.wasd.acceleration;
    const maxSpeed = wasd.maxSpeed || controlDefaults.wasd.maxSpeed;
    const drag = wasd.drag || controlDefaults.wasd.drag;
    const sensitivity = wasd.sensitivity || controlDefaults.wasd.sensitivity;

    if (keys.KeyW) velocity.y -= accel * dt;
    if (keys.KeyS) velocity.y += accel * dt;
    if (keys.KeyA) velocity.x += accel * dt;
    if (keys.KeyD) velocity.x -= accel * dt;

    velocity.x -= velocity.x * drag * dt;
    velocity.y -= velocity.y * drag * dt;
    velocity.x = Math.max(-maxSpeed, Math.min(maxSpeed, velocity.x));
    velocity.y = Math.max(-maxSpeed, Math.min(maxSpeed, velocity.y));

    const rot = Math.PI / 4;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const moveX = (velocity.y * cos - velocity.x * sin) * dt * sensitivity * 0.005;
    const moveZ = (velocity.y * sin + velocity.x * cos) * dt * sensitivity * 0.005;
    camera.position.x += moveX;
    camera.position.z += moveZ;
    lockIsometric();
  };

  let zoomVelocity = 0;
  let zoomPointer = { x: 0, y: 0 };
  const onWheel = (event) => {
    event.preventDefault();
    const zoomSensitivity = Number.isFinite(controls.zoomSensitivity)
      ? controls.zoomSensitivity
      : controlDefaults.zoomSensitivity;
    const rawDelta = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    const deltaModeScale = event.deltaMode === 1 ? 18 : (event.deltaMode === 2 ? 360 : 1);
    const delta = -rawDelta * deltaModeScale * 0.0025;
    const ndc = getPointerNdc(event);
    zoomPointer = { x: ndc.x, y: ndc.y };
    zoomVelocity += delta * zoomSensitivity;
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  let lastTime = performance.now();
  let fpsState = { start: lastTime, frames: 0 };
  const animate = () => {
    requestAnimationFrame(animate);
    const now = performance.now();
    const frameMs = now - lastTime;
    const dt = Math.min(0.05, frameMs / 1000);
    lastTime = now;
    updateCamera(dt);
    if (Math.abs(zoomVelocity) > 0.0001) {
      const zoomMin = Number.isFinite(controls.zoomMin)
        ? controls.zoomMin
        : controlDefaults.zoomMin;
      const zoomMax = Number.isFinite(controls.zoomMax) ? controls.zoomMax : controlDefaults.zoomMax;
      const before = getPlanePointFromNdc(zoomPointer);
      camera.zoom = Math.max(zoomMin, Math.min(zoomMax, camera.zoom + zoomVelocity * dt));
      camera.updateProjectionMatrix();
      const after = getPlanePointFromNdc(zoomPointer);
      if (before && after) {
        camera.position.add(before.sub(after));
        lockIsometric();
      }
      const damping = Number.isFinite(controls.zoomDamping) ? controls.zoomDamping : controlDefaults.zoomDamping;
      zoomVelocity *= Math.pow(damping, dt * 60);
      if (Math.abs(zoomVelocity) < 0.0001) zoomVelocity = 0;
    }
    const glowSpeed = Math.max(0, numberValue(visuals.glowPulseSpeed, visualDefaults.glowPulseSpeed));
    const pulse = glowSpeed > 0
      ? (0.5 + 0.5 * Math.sin(now * 0.002 * glowSpeed))
      : 0.5;

    const fileVisible = state.fileGroup?.visible !== false;
    const memberVisible = state.memberGroup?.visible !== false;
    const edgeVisible = state.edgeGroup?.visible !== false;
    const wireVisible = state.wireGroup?.visible !== false;
    const gridVisible = state.gridLines?.visible !== false;

    if (fileVisible || memberVisible) {
      for (const material of state.glowMaterials) {
        const base = material.userData?.glowBase ?? 0;
        const range = material.userData?.glowRange ?? 0.05;
        material.emissiveIntensity = base + range * pulse;
      }
    }

    const flowSpeed = glowSpeed;
    const wireSpeedGlobal = Math.max(0, numberValue(visuals.wirePulseSpeed, visualDefaults.wirePulseSpeed));
    const gridSpeedGlobal = Math.max(0, numberValue(visuals.gridPulseSpeed, visualDefaults.gridPulseSpeed));
    if (edgeVisible) {
      for (const material of state.flowMaterials) {
        const base = material.userData?.glowBase ?? 0;
        const range = material.userData?.glowRange ?? 0.05;
        const phase = material.userData?.flowPhase ?? 0;
        const dir = material.userData?.flowDir ?? 1;
        const typeSpeed = material.userData?.flowSpeed ?? 1;
        const offset = material.userData?.flowOffset ?? 0;
        let waveSum = 0;
        for (const layer of flowWaveLayers) {
          waveSum += layer.amplitude * (0.5 + 0.5 * Math.sin(now * 0.002 * flowSpeed * layer.speed * typeSpeed + offset - phase * dir));
        }
        const waveValue = waveSum / flowWaveTotal;
        material.emissiveIntensity = base + range * waveValue;
      }
    }

    if (wireVisible) {
      for (const material of state.wireMaterials) {
        const base = material.userData?.glowBase ?? 0.3;
        const range = material.userData?.glowRange ?? 0.4;
        const phase = material.userData?.flowPhase ?? 0;
        const wireSpeed = material.userData?.flowSpeed ?? wireSpeedGlobal;
        const wirePulse = 0.5 + 0.5 * Math.sin(now * 0.002 * wireSpeed - phase);
        material.opacity = clamp(base + range * wirePulse, 0.02, 0.35);
      }
    }

    if (gridVisible) {
      for (const material of state.gridLineMaterials) {
        const base = material.userData?.glowBase ?? 0.1;
        const range = material.userData?.glowRange ?? 0.2;
        const phase = material.userData?.flowPhase ?? 0;
        const gridSpeed = material.userData?.flowSpeed ?? gridSpeedGlobal;
        const gridPulse = 0.5 + 0.5 * Math.sin(now * 0.002 * gridSpeed + phase);
        material.opacity = clamp(base + range * gridPulse, 0.02, 0.6);
      }
    }

    if (edgeVisible) {
      for (const light of state.flowLights) {
        const base = light.userData?.base ?? 0.8;
        const phase = light.userData?.flowPhase ?? 0;
        const dir = light.userData?.flowDir ?? 1;
        const typeSpeed = light.userData?.flowSpeed ?? 1;
        const offset = light.userData?.flowOffset ?? 0;
        let waveSum = 0;
        for (const layer of flowWaveLayers) {
          waveSum += layer.amplitude * (0.5 + 0.5 * Math.sin(now * 0.002 * flowSpeed * layer.speed * typeSpeed + offset - phase * dir));
        }
        const waveValue = waveSum / flowWaveTotal;
        light.intensity = base * (0.4 + 0.6 * waveValue);
      }
    } else {
      for (const light of state.flowLights) {
        light.intensity = 0;
      }
    }

    const perfStats = state.perfStats || (state.perfStats = {});
    const budgetMs = Number.isFinite(state.performance?.frameBudgetMs)
      ? state.performance.frameBudgetMs
      : 18;
    const mem = performance?.memory?.usedJSHeapSize;
    const perfUpdate = updatePerfStats({
      perfStats,
      now,
      frameMs,
      budgetMs,
      fpsState,
      heapUsed: Number.isFinite(mem) ? mem : null
    });
    state.perfStats = perfUpdate.stats;
    fpsState = perfUpdate.fpsState;

    const edgeCount = state.drawCounts?.edges || 0;
    const lodTier = resolveLodTier({
      zoom: camera.zoom,
      edgeCount,
      frameMs,
      performance: state.performance
    });
    applyLodTier(state, lodTier);

    if (state.dom?.perfHud && state.performance?.hud?.enabled) {
      const heapMb = perfStats.heapUsed ? Math.round(perfStats.heapUsed / (1024 * 1024)) : null;
      const parts = [
        `fps: ${perfStats.fps || 0}`,
        `frame: ${perfStats.frameMs || 0}ms`,
        `dropped: ${perfStats.droppedFrames || 0}`,
        `edges: ${edgeCount}`
      ];
      if (heapMb !== null) parts.push(`heap: ${heapMb}MB`);
      state.dom.perfHud.textContent = parts.join(' | ');
      state.dom.perfHud.style.display = 'block';
    } else if (state.dom?.perfHud) {
      state.dom.perfHud.style.display = 'none';
    }

    cullTimer += dt;
    if (cullTimer >= cullInterval) {
      cullTimer = 0;
      updateMemberCulling();
      updateFileCulling();
      updateEdgeCulling();
    }

    renderer.render(state.scene, camera);
  };
  animate();

  const onResize = () => {
    const viewport = getViewport();
    const aspect = viewport.width / viewport.height;
    const base = state.cameraBase;
    camera.left = -base * aspect;
    camera.right = base * aspect;
    camera.top = base;
    camera.bottom = -base;
    camera.near = state.nearPlane;
    camera.far = state.farPlane;
    camera.updateProjectionMatrix();
    lineResolution.width = viewport.width;
    lineResolution.height = viewport.height;
    for (const material of state.wireMaterials) {
      if (material.resolution && typeof material.resolution.set === 'function') {
        material.resolution.set(lineResolution.width, lineResolution.height);
      }
    }
    for (const material of state.gridLineMaterials) {
      if (material.resolution && typeof material.resolution.set === 'function') {
        material.resolution.set(lineResolution.width, lineResolution.height);
      }
    }
    const pixelRatioCap = numberValue(visuals.pixelRatioCap, visualDefaults.pixelRatioCap);
    renderer.setPixelRatio(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
    renderer.setSize(viewport.width, viewport.height);
    lockIsometric();
  };
  window.addEventListener('resize', onResize);
  onResize();
};
