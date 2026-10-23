import { focusStack } from './stack-navigation.js';
import { state } from './state.js';
import { clamp, numberValue } from './utils.js';
import { toArray } from '../../../shared/iterables.js';
import { applyHighlights, setSelection, openSelection } from './selection.js';
import { applyBucketCulling, applyEdgeCulling, forceBucketVisible } from './culling.js';
import { resolveLodTier, applyLodTier } from './lod.js';
import { updatePerfStats } from './telemetry.js';
import { createHoverFrame } from './hover-frame.js';
import { createRenderLoop } from './render-loop.js';
import { createViewportInputOwner } from './input-ownership.js';
import { createControlsPickingOwner } from './rendering/picking-owner.js';
import { createControlsLifetime, retirePreviousControls } from './controls-lifetime.js';
import { captureControlsRuntimeCallbacks } from './controls-runtime-callbacks.js';

export const initControls = () => {
  retirePreviousControls(state);
  const lifetime = createControlsLifetime(state), { listen } = lifetime;
  let frameLoop = null, inputOwner = null, hover = null;
  let invalidateHover = null, invalidateRender = null;
  return lifetime.construct(() => {
    invalidateHover = lifetime.publish('invalidateHover', () => hover?.invalidate());
    invalidateRender = lifetime.publish('invalidateRender', () => frameLoop?.invalidate());
    const picker = createControlsPickingOwner(lifetime.current);
    lifetime.onDetach(picker.detachCaptured);
    lifetime.adopt({ dispose: picker.retireCaptured }, 'original controls resident picking');
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
    const ownsControls = lifetime.owns;
    const rendererCallbacks = captureControlsRuntimeCallbacks(renderer, ['render', 'setPixelRatio', 'setSize'], lifetime.wrap, lifetime.current);
    if (!lifetime.current()) throw new Error('Controls runtime callback capture lost its original authority.');
    const cameraCallbacks = captureControlsRuntimeCallbacks(camera, ['updateMatrixWorld', 'updateProjectionMatrix'], lifetime.wrap, lifetime.current);
    if (!lifetime.current()) throw new Error('Controls runtime callback capture lost its original authority.');

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const zoomRaycaster = new THREE.Raycaster();

    const fillPickTargets = () => {
      const targets = state.pickTargets || (state.pickTargets = []);
      targets.length = 0;

      // Stack index keeps every resident object. Visibility is evaluated at query
      // time so hiding a group never removes its geometry from the next query.
      const fileVisible = state.layoutStyle === 'stacks' || state.fileGroup?.visible !== false;
      const memberVisible = state.layoutStyle === 'stacks' || state.memberGroup?.visible !== false;

      if (fileVisible) {
        targets.push(...toArray(state.fileInstancedMeshes));
        targets.push(...toArray(state.fileMeshes));
      }

      if (memberVisible) {
        for (const mesh of toArray(state.memberInstancedMeshes)) {
          // Cluster culling toggles parent visibility.
          if (state.layoutStyle === 'stacks' || mesh?.parent?.visible !== false) targets.push(mesh);
        }
        // Legacy (non-instanced) members.
        targets.push(...toArray(state.memberMeshes));
      }

      return targets;
    };
    const pick = () => state.layoutStyle === 'stacks'
      ? picker.pick(raycaster, pointer, fillPickTargets)
      : raycaster.intersectObjects(fillPickTargets(), false);

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

      const selected = state.selectedInfo;
      const selectedId = selected?.type === 'member' && selected.id != null ? selected.id : null;
      const selectedCluster = selectedId !== null ? state.memberClusterByMemberId?.get(selectedId) : null;
      for (const cluster of state.memberClusters) {
        if (!cluster?.group || !cluster?.sphere) continue;
        const visible = cluster === selectedCluster || cluster.group === selectedCluster || cluster.group === selectedCluster?.group
          || cullFrustum.intersectsSphere(cluster.sphere);
        if (cluster.group.visible !== visible) invalidateHover();
        cluster.group.visible = visible;
      }

    };

    const updateFileCulling = () => {
      if (!state.fileBuckets || !state.fileBuckets.length) return;
      if (state.fileGroup?.visible === false) return;
      cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      cullFrustum.setFromProjectionMatrix(cullMatrix);
      const selected = state.selectedInfo;
      const fileKey = selected?.type === 'file' ? (selected.file || selected.name) : null;
      const selectedBucket = fileKey ? state.fileBucketByKey?.get(fileKey) : null;
      const changed = applyBucketCulling({ frustum: cullFrustum, buckets: state.fileBuckets, hiddenMatrix, forceVisible: selectedBucket });
      if (changed.size) invalidateHover();

      if (fileKey && state.fileBucketByKey?.has(fileKey)) {
        const bucket = state.fileBucketByKey.get(fileKey);
        if (bucket.visible === false) forceBucketVisible(bucket);
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
      if (!rect.width || !rect.height) return null;
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
      if (lifetime.disposed || !ownsControls()) return false;
      const ndc = getPointerNdc(event);
      if (!ndc || lifetime.disposed || !ownsControls()) return false;
      hover.move(event);
      if (lifetime.disposed || !ownsControls()) return false;
      pointer.x = ndc.x;
      pointer.y = ndc.y;
      raycaster.setFromCamera(pointer, camera);
      if (lifetime.disposed || !ownsControls()) return false;
      const hits = pick();
      if (lifetime.disposed || !ownsControls()) return false;
      if(hits[0]?.object?.userData?.type==='snapshotAggregate'){state.openSnapshotAggregate?.(hits[0].object.userData);return false;}
      setSelection(hits.length ? hits[0] : null);
      if (lifetime.disposed || !ownsControls()) return false;
    };

    let dragging = false;
    let dragMoved = false;
    let lastPointer = { x: 0, y: 0 };

    const startDrag = (event) => {
      picker.cancelCaptured();
      cancelMotion();
      dragging = true;
      hover.move(event);
      hover.startDrag();
      dragMoved = false;
      lastPointer = { x: event.clientX, y: event.clientY };
      invalidateRender();
    };

    const moveDrag = (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) dragMoved = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      const ndc = getPointerNdc(event);
      if (!ndc) return;
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
      invalidateRender();
    };

    const updateHover = (event) => {
      if (dragging || lifetime.disposed || !ownsControls()) return;
      const ndc = getPointerNdc(event);
      if (lifetime.disposed || !ownsControls()) return;
      if (!ndc) { state.hovered = null; applyHighlights(); return; }
      pointer.x = ndc.x;
      pointer.y = ndc.y;
      raycaster.setFromCamera(pointer, camera);
      if (lifetime.disposed || !ownsControls()) return;
      const hits = pick();
      if (lifetime.disposed || !ownsControls()) return;
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
      hover.endDrag();
      invalidateRender();
    };

    hover = lifetime.adopt(createHoverFrame({ pick: updateHover, isCurrent: lifetime.canClear, clear: () => {
      if (state.hovered !== null) { state.hovered = null; applyHighlights(); }
    } }), 'original controls hover', ['move', 'invalidate', 'startDrag', 'endDrag', 'leave', 'frame']);

    listen(renderer.domElement, 'pointerdown', startDrag);
    listen(window, 'pointermove', moveDrag);
    listen(window, 'pointerup', endDrag);
    listen(renderer.domElement, 'pointerleave', endDrag);
    listen(renderer.domElement, 'pointermove', (event) => { picker.cancelCaptured(); hover.move(event); invalidateRender(); });
    listen(renderer.domElement, 'pointerleave', () => {
      picker.cancelCaptured();
      hover.leave();
      invalidateRender();
    });

    listen(renderer.domElement, 'click', (event) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      onPointer(event);
    });
    listen(renderer.domElement, 'dblclick', (event) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      if(onPointer(event)!==false && !lifetime.disposed && ownsControls())openSelection();
    });

    const velocity = new THREE.Vector2(0, 0);
    let zoomVelocity = 0;
    const inputCurrent = () => !lifetime.disposed && ownsControls();
    const cancelMotion = () => { if (!inputCurrent()) return; picker.cancelCaptured(); velocity.set(0,0); zoomVelocity=0; endDrag(); };
    inputOwner=lifetime.adopt(createViewportInputOwner({ viewport:dom.app, canvas:renderer.domElement, window, document,
      cancelMotion, invalidate:invalidateRender, isCurrent:inputCurrent, shortcut:event=>{
        if(state.layoutStyle!=='stacks'||!['KeyF','Home','Escape','Enter'].includes(event.code))return false;
        cancelMotion();
        if(event.code==='Escape')setSelection(null);
        else if(event.code==='Enter')openSelection();
        else focusStack(event.code==='Home'?null:state.selectedInfo);
        invalidateRender(); return true;
      } }), 'original controls viewport input', [], ['keys']);
    const keys=inputOwner.keys;
    lifetime.publish('cancelCameraMotion', cancelMotion);

    const updateCamera = (dt) => {
      if(state.layoutStyle==='stacks'){
        const x=Number(Boolean(keys.KeyD))-Number(Boolean(keys.KeyA)),y=Number(Boolean(keys.KeyS))-Number(Boolean(keys.KeyW));
        const length=Math.hypot(x,y)||1,blend=motionAllowed()?1-Math.exp(-12*Math.min(dt,0.1)):1;
        velocity.x+=(x/length-velocity.x)*blend;velocity.y+=(y/length-velocity.y)*blend;
        const speed=(camera.top-camera.bottom)/Math.max(0.05,camera.zoom)*0.55;
        const distance=Math.min(dt,0.1)*speed/Math.sqrt(2);
        camera.position.x+=(velocity.x+velocity.y)*distance;camera.position.z+=(velocity.y-velocity.x)*distance;lockIsometric();return;
      }

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
      if (!ndc) return;
      zoomPointer = { x: ndc.x, y: ndc.y };
      zoomVelocity += delta * zoomSensitivity;
      invalidateRender();
    };
    listen(renderer.domElement, 'wheel', onWheel, { passive: false });

    let lastTime = performance.now();
    let effectTime = 0, lastHudTime = -Infinity;
    const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const motionAllowed=()=>state.motionOverride==='on'||(state.motionOverride!=='off'&&!reducedMotion?.matches);
    const hasEffects=()=>motionAllowed()&&(((state.fileGroup?.visible!==false||state.memberGroup?.visible!==false)&&state.glowMaterials.length>0&&visuals.glowPulseSpeed>0)
      ||(state.edgeGroup?.visible!==false&&(state.flowMaterials.length+state.flowLights.length)>0&&visuals.glowPulseSpeed>0)
      ||(state.wireGroup?.visible!==false&&state.wireMaterials.length>0&&visuals.wirePulseSpeed>0)
      ||(state.gridLines?.visible!==false&&state.gridLineMaterials.length>0&&visuals.gridPulseSpeed>0));
    let fpsState = { start: lastTime, frames: 0 };
    const cameraSnapshot = new Float64Array(32).fill(NaN);
    let cameraSeen=false;
    let fileVisibleSnapshot, memberVisibleSnapshot;
    const refreshHoverCamera = () => {
      cameraCallbacks.updateMatrixWorld();
      if (lifetime.disposed || !ownsControls()) return;
      const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements;
      let changed = false;
      for (let index = 0; index < 16; index += 1) {
        if (cameraSnapshot[index] !== world[index] || cameraSnapshot[index + 16] !== projection[index]) changed = true;
        cameraSnapshot[index] = world[index]; cameraSnapshot[index + 16] = projection[index];
      }
      if (fileVisibleSnapshot !== state.fileGroup?.visible || memberVisibleSnapshot !== state.memberGroup?.visible) changed = true;
      fileVisibleSnapshot = state.fileGroup?.visible; memberVisibleSnapshot = state.memberGroup?.visible;
      if (changed) {
        invalidateHover();
        state.cameraRevision=(state.cameraRevision||0)+1;
        picker.cancelCaptured();
        if(cameraSeen)state.viewRevisions?.bump('camera');
      }
      cameraSeen=true;
    };
    const animate = (now, {continuous}) => {
      if (lifetime.disposed || !ownsControls()) return false;
      const started=performance.now();
      const frameMs = continuous ? now-lastTime : 0;
      const dt = continuous ? Math.min(0.05, frameMs/1000) : 1/60;
      lastTime = now;
      if(motionAllowed())effectTime+=dt*1000;
      updateCamera(dt);
      if (lifetime.disposed || !ownsControls()) return false;
      if (Math.abs(zoomVelocity) > 0.0001) {
        const zoomMin = state.cameraZoomRange?.min??(Number.isFinite(controls.zoomMin)
          ? controls.zoomMin
          : controlDefaults.zoomMin);
        const zoomMax = state.cameraZoomRange?.max??(Number.isFinite(controls.zoomMax) ? controls.zoomMax : controlDefaults.zoomMax);
        const before = getPlanePointFromNdc(zoomPointer);
        if (!lifetime.current()) return false;
        camera.zoom = Math.max(zoomMin, Math.min(zoomMax, camera.zoom * Math.exp(zoomVelocity * dt)));
        cameraCallbacks.updateProjectionMatrix();
        if (!lifetime.current()) return false;
        const after = getPlanePointFromNdc(zoomPointer);
        if (!lifetime.current()) return false;
        if (before && after) {
          camera.position.add(before.sub(after));
          lockIsometric();
          if (!lifetime.current()) return false;
        }
        const damping = Number.isFinite(controls.zoomDamping) ? controls.zoomDamping : controlDefaults.zoomDamping;
        zoomVelocity *= Math.pow(damping, dt * 60);
        if (Math.abs(zoomVelocity) < 0.0001) zoomVelocity = 0;
      }
      const glowSpeed = Math.max(0, numberValue(visuals.glowPulseSpeed, visualDefaults.glowPulseSpeed));
      const pulse = motionAllowed()&&glowSpeed > 0
        ? (0.5 + 0.5 * Math.sin(effectTime * 0.002 * glowSpeed))
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
            waveSum += layer.amplitude * (motionAllowed()?0.5+0.5*Math.sin(effectTime*0.002*flowSpeed*layer.speed*typeSpeed+offset-phase*dir):0.5);
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
          const wirePulse = motionAllowed()?0.5+0.5*Math.sin(effectTime*0.002*wireSpeed-phase):0.5;
          material.opacity = clamp(base + range * wirePulse, 0.02, 0.35);
        }
      }

      if (gridVisible) {
        for (const material of state.gridLineMaterials) {
          const base = material.userData?.glowBase ?? 0.1;
          const range = material.userData?.glowRange ?? 0.2;
          const phase = material.userData?.flowPhase ?? 0;
          const gridSpeed = material.userData?.flowSpeed ?? gridSpeedGlobal;
          const gridPulse = motionAllowed()?0.5+0.5*Math.sin(effectTime*0.002*gridSpeed+phase):0.5;
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
            waveSum += layer.amplitude * (motionAllowed()?0.5+0.5*Math.sin(effectTime*0.002*flowSpeed*layer.speed*typeSpeed+offset-phase*dir):0.5);
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
        heapUsed: Number.isFinite(mem) ? mem : null,
        intervalValid: continuous
      });
      state.perfStats = perfUpdate.stats;
      fpsState = perfUpdate.fpsState;

      const edgeCount = state.drawCounts?.edges || 0;
      const lodTier = resolveLodTier({
        zoom: camera.zoom,
        edgeCount,
        frameMs: 0,
        performance: state.performance
      });
      applyLodTier(state, lodTier);

      if (state.dom?.perfHud && state.performance?.hud?.enabled && now-lastHudTime>=250) {
        lastHudTime=now;
        const heapMb = perfStats.heapUsed ? Math.round(perfStats.heapUsed / (1024 * 1024)) : null;
        const parts = [
          `callbacks/s: ${perfStats.fps ?? 'unavailable'}`,
          `callback interval: ${perfStats.callbackIntervalMs ?? 'unavailable'}ms`,
          `slow callbacks: ${perfStats.slowCallbacks || 0}`,
          `CPU update/submission: ${perfStats.submissionMs ?? 'unavailable'}ms`,
          `edges: ${edgeCount}`
        ];
        if (heapMb !== null) parts.push(`heap: ${heapMb}MB`);
        if(state.pipeBufferMetrics){
          parts.push(`pipe vertex capacity: ${state.pipeBufferMetrics.attributeCapacityBytes}B`);
          parts.push(`pipe writes requested: ${state.pipeBufferMetrics.requestedUploadBytes}B`);
        }
        if(perfStats.renderer)parts.push(`last submission calls: ${perfStats.renderer.calls ?? 'unavailable'}`);
        state.dom.perfHud.textContent = parts.join(' | ');
        state.dom.perfHud.style.display = 'block';
      } else if (state.dom?.perfHud && !state.performance?.hud?.enabled) {
        state.dom.perfHud.style.display = 'none';
      }

      cullTimer += continuous ? dt : cullInterval;
      if (cullTimer >= cullInterval) {
        cullTimer = 0;
        updateMemberCulling();
        updateFileCulling();
        updateEdgeCulling();
      }

      refreshHoverCamera();
      if (lifetime.disposed || !ownsControls()) return false;
      hover.frame();
      if (lifetime.disposed || !ownsControls()) return false;
      rendererCallbacks.render(state.scene, camera);
      if (lifetime.disposed || !ownsControls()) return false;
      const renderInfo=renderer.info;
      perfStats.renderer=renderInfo?{calls:renderInfo.render?.calls??null,triangles:renderInfo.render?.triangles??null,
        lines:renderInfo.render?.lines??null,points:renderInfo.render?.points??null,
        geometries:renderInfo.memory?.geometries??null,textures:renderInfo.memory?.textures??null,
        programs:renderInfo.programs?.length??null,scope:'last renderer submission; resource counts are renderer caches, not GPU byte measurements'}:null;
      perfStats.submissionMs=Math.round((performance.now()-started)*100)/100;
      return hasEffects()||Object.keys(keys).length>0||velocity.lengthSq()>0.000001||Math.abs(zoomVelocity)>0.0001||dragging;
    };
    frameLoop=lifetime.adopt(createRenderLoop({render:lifetime.wrap(animate),visible:lifetime.wrap(()=>!document.hidden&&!state.contextLost)}),
      'original controls frame loop', ['invalidate', 'visibilityChanged']);
    if(reducedMotion)listen(reducedMotion,'change',()=>{cancelMotion();invalidateRender();});
    listen(document,'visibilitychange',()=>frameLoop.visibilityChanged());
    for(const event of ['click','input','change','toggle'])listen(dom.app,event,invalidateRender,true);

    const onResize = () => {
      const viewport = getViewport();
      if (!lifetime.current()) return;
      const aspect = viewport.width / viewport.height;
      const base = state.cameraBase;
      camera.left = -base * aspect;
      camera.right = base * aspect;
      camera.top = base;
      camera.bottom = -base;
      camera.near = state.nearPlane;
      camera.far = state.farPlane;
      cameraCallbacks.updateProjectionMatrix();
      if (!lifetime.current()) return;
      lineResolution.width = viewport.width;
      lineResolution.height = viewport.height;
      for (const material of state.wireMaterials) {
        if (material.resolution && typeof material.resolution.set === 'function') {
          material.resolution.set(lineResolution.width, lineResolution.height);
          if (!lifetime.current()) return;
        }
      }
      for (const material of state.gridLineMaterials) {
        if (material.resolution && typeof material.resolution.set === 'function') {
          material.resolution.set(lineResolution.width, lineResolution.height);
          if (!lifetime.current()) return;
        }
      }
      const pixelRatioCap = numberValue(visuals.pixelRatioCap, visualDefaults.pixelRatioCap);
      rendererCallbacks.setPixelRatio(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
      if (!lifetime.current()) return;
      rendererCallbacks.setSize(viewport.width, viewport.height);
      if (!lifetime.current()) return;
      lockIsometric();
      if (!lifetime.current()) return;
      invalidateRender();
    };
    listen(window, 'resize', onResize);
    listen(window, 'scroll', invalidateHover, true);
    listen(window, 'pagehide', lifetime.shutdownScene);
    onResize();
    invalidateRender();
  });
};
