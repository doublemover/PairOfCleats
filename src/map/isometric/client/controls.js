import { state } from './state.js';
import { clamp } from './utils.js';
import { applyHighlights, setSelection, openSelection } from './selection.js';

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
    const hits = raycaster.intersectObjects([...state.memberMeshes, ...state.fileMeshes]);
    const target = hits.length ? hits[0].object : null;
    setSelection(target);
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
    const hits = raycaster.intersectObjects([...state.memberMeshes, ...state.fileMeshes]);
    const nextHover = hits.length ? hits[0].object : null;
    if (nextHover !== state.hoveredMesh) {
      state.hoveredMesh = nextHover;
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
    state.hoveredMesh = null;
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
    const delta = -rawDelta * deltaModeScale * 0.05;
    const ndc = getPointerNdc(event);
    zoomPointer = { x: ndc.x, y: ndc.y };
    const direction = Math.sign(delta);
    const velocityDir = Math.sign(zoomVelocity);
    const momentumBoost = Math.min(6, Math.abs(zoomVelocity) * 0.6);
    const repeatBoost = direction !== 0 && direction === velocityDir ? 1 + momentumBoost : 1;
    zoomVelocity += delta * zoomSensitivity * (2 + repeatBoost);
  };
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  let lastTime = performance.now();
  let lastPulseUpdate = 0;
  const animate = () => {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
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
    if (now - lastPulseUpdate > 33) {
      lastPulseUpdate = now;
      for (const material of state.glowMaterials) {
        const base = material.userData?.glowBase ?? 0;
        const range = material.userData?.glowRange ?? 0.05;
        const glowSpeed = material.userData?.glowSpeed ?? 1;
        const glowPhase = material.userData?.glowPhase ?? 0;
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.002 * glowSpeed + glowPhase);
        material.emissiveIntensity = base + range * pulse;
      }
      const flowSpeed = visuals.glowPulseSpeed || visualDefaults.glowPulseSpeed;
      for (const material of state.flowMaterials) {
        const base = material.userData?.glowBase ?? 0;
        const range = material.userData?.glowRange ?? 0.05;
        const phase = material.userData?.flowPhase ?? 0;
        const dir = material.userData?.flowDir ?? 1;
        const typeSpeed = material.userData?.flowSpeed ?? 1;
        const offset = material.userData?.flowOffset ?? 0;
        let waveSum = 0;
        for (const layer of flowWaveLayers) {
          const waveTime =
            now * 0.002 * flowSpeed * layer.speed * typeSpeed + offset - phase * dir;
          waveSum += layer.amplitude * (0.5 + 0.5 * Math.sin(waveTime));
        }
        const waveValue = waveSum / flowWaveTotal;
        material.emissiveIntensity = base + range * waveValue;
      }
      for (const material of state.wireMaterials) {
        const base = material.userData?.glowBase ?? 0.3;
        const range = material.userData?.glowRange ?? 0.4;
        const phase = material.userData?.flowPhase ?? 0;
        const wireSpeed =
          material.userData?.flowSpeed ??
          visuals.wirePulseSpeed ??
          visualDefaults.wirePulseSpeed;
        const wirePulse = 0.5 + 0.5 * Math.sin(now * 0.002 * wireSpeed - phase);
        material.opacity = clamp(base + range * wirePulse, 0.02, 0.6);
      }
      for (const material of state.gridLineMaterials) {
        const base = material.userData?.glowBase ?? 0.1;
        const range = material.userData?.glowRange ?? 0.2;
        const phase = material.userData?.flowPhase ?? 0;
        const gridSpeed =
          material.userData?.flowSpeed ??
          visuals.gridPulseSpeed ??
          visualDefaults.gridPulseSpeed;
        const gridPulse = 0.5 + 0.5 * Math.sin(now * 0.002 * gridSpeed + phase);
        material.opacity = clamp(base + range * gridPulse, 0.02, 0.6);
      }
      for (const light of state.flowLights) {
        const base = light.userData?.base ?? 0.8;
        const phase = light.userData?.flowPhase ?? 0;
        const dir = light.userData?.flowDir ?? 1;
        const typeSpeed = light.userData?.flowSpeed ?? 1;
        const offset = light.userData?.flowOffset ?? 0;
        let waveSum = 0;
        for (const layer of flowWaveLayers) {
          const waveTime =
            now * 0.002 * flowSpeed * layer.speed * typeSpeed + offset - phase * dir;
          waveSum += layer.amplitude * (0.5 + 0.5 * Math.sin(waveTime));
        }
        const waveValue = waveSum / flowWaveTotal;
        light.intensity = base * (0.4 + 0.6 * waveValue);
      }
    }
    lockIsometric();
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
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(viewport.width, viewport.height);
    lockIsometric();
  };
  window.addEventListener('resize', onResize);
  onResize();
};
