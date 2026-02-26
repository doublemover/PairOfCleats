import { state } from './state.js';
import { numberValue } from './utils.js';
import { toArray } from '../../../shared/iterables.js';

export const initScene = async () => {
  const { THREE, dom, RGBELoader, assets, visuals } = state;
  const { app } = dom;

  const getViewport = () => {
    const rect = app.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    return { width, height };
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const pixelRatioCap = numberValue(visuals.pixelRatioCap, 2);
  renderer.setPixelRatio(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
  const initialViewport = getViewport();
  const lineResolution = { width: initialViewport.width, height: initialViewport.height };
  renderer.setSize(initialViewport.width, initialViewport.height);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.physicallyCorrectLights = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.9;
  renderer.shadowMap.enabled = visuals.enableShadows === true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (renderer.outputColorSpace !== undefined) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1115');

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(50, 80, 30);
  dirLight.castShadow = visuals.enableShadows === true;
  scene.add(dirLight);
  const purpleSun = new THREE.DirectionalLight(0x8f6bff, 2.6);
  purpleSun.position.set(220, 12, -190);
  purpleSun.castShadow = visuals.enableShadows === true;
  purpleSun.shadow.mapSize.set(2048, 2048);
  purpleSun.shadow.bias = -0.00015;
  purpleSun.shadow.normalBias = 0.02;
  purpleSun.shadow.camera.near = 1;
  purpleSun.shadow.camera.far = 600;
  purpleSun.shadow.camera.left = -220;
  purpleSun.shadow.camera.right = 220;
  purpleSun.shadow.camera.top = 220;
  purpleSun.shadow.camera.bottom = -220;
  scene.add(purpleSun);
  const hemiLight = new THREE.HemisphereLight(0x6fb1ff, 0x2b2f3a, 0.8);
  scene.add(hemiLight);
  const fillLight = new THREE.PointLight(0x9fd3ff, 1.0, 260);
  fillLight.position.set(-40, 35, -20);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0x6fb1ff, 1.4);
  rimLight.position.set(-80, 60, 80);
  const accentLight = new THREE.PointLight(0xffe6b5, 1.2, 220);
  accentLight.position.set(40, 50, -70);
  const extraLights = [rimLight, accentLight];
  extraLights.forEach((light) => scene.add(light));

  const fileGroup = new THREE.Group();
  const memberGroup = new THREE.Group();
  const labelGroup = new THREE.Group();
  const wireGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  scene.add(fileGroup);
  scene.add(memberGroup);
  scene.add(labelGroup);
  scene.add(wireGroup);
  scene.add(edgeGroup);
  edgeGroup.renderOrder = 1;
  fileGroup.renderOrder = 3;
  memberGroup.renderOrder = 4;
  wireGroup.renderOrder = 6;
  labelGroup.renderOrder = 7;
  labelGroup.visible = false;

  let cameraBase = 40;
  let nearPlane = 0.1;
  let farPlane = 2000;
  const camera = new THREE.OrthographicCamera(-cameraBase, cameraBase, cameraBase, -cameraBase, nearPlane, farPlane);
  camera.matrixAutoUpdate = true;
  const isoYaw = Math.PI / 4;
  const isoPitch = -Math.atan(1 / Math.sqrt(2));
  const isoEuler = new THREE.Euler(isoPitch, isoYaw, 0, 'YXZ');
  const isoQuaternion = new THREE.Quaternion().setFromEuler(isoEuler);
  const isoUp = new THREE.Vector3(0, 1, 0);
  camera.position.set(60, 54, 60);
  camera.quaternion.copy(isoQuaternion);
  camera.up.copy(isoUp);
  const lockIsometric = () => {
    camera.up.copy(isoUp);
    camera.quaternion.copy(isoQuaternion);
    camera.updateMatrixWorld();
  };

  const applyEnvironment = (texture) => {
    if (!texture) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(texture).texture;
    pmrem.dispose();
  };

  const envCanvas = document.createElement('canvas');
  envCanvas.width = 32;
  envCanvas.height = 16;
  const envCtx = envCanvas.getContext('2d');
  const gradient = envCtx.createLinearGradient(0, 0, envCanvas.width, envCanvas.height);
  gradient.addColorStop(0, '#1b2230');
  gradient.addColorStop(0.5, '#6fb1ff');
  gradient.addColorStop(1, '#0f1115');
  envCtx.fillStyle = gradient;
  envCtx.fillRect(0, 0, envCanvas.width, envCanvas.height);
  const fallbackEnv = new THREE.CanvasTexture(envCanvas);
  applyEnvironment(fallbackEnv);
  fallbackEnv.dispose();

  if (RGBELoader && assets.hdrEnvUrl) {
    const rgbe = new RGBELoader();
    rgbe.load(assets.hdrEnvUrl, (hdrTexture) => {
      applyEnvironment(hdrTexture);
      hdrTexture.dispose();
    });
  }

  Object.assign(state, {
    renderer,
    scene,
    camera,
    lineResolution,
    getViewport,
    lockIsometric,
    cameraBase,
    nearPlane,
    farPlane,
    cameraInitialized: false,
    extraLights,
    mainLight: dirLight,
    sunLight: purpleSun,
    fileGroup,
    memberGroup,
    labelGroup,
    wireGroup,
    edgeGroup,
    grid: null,
    gridLines: null,
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    fogBounds: { maxSpan: 120 },
    scaleFactor: 2
  });

  if (visuals?.enableExtraLights === false) {
    extraLights.forEach((light) => { light.visible = false; });
  }
};


export const applyRendererSettings = () => {
  const { renderer, visuals, visualDefaults, getViewport, mainLight, sunLight } = state;
  if (!renderer || !getViewport) return;

  const viewport = getViewport();
  const pixelRatioCap = numberValue(visuals.pixelRatioCap, visualDefaults?.pixelRatioCap ?? 2);
  renderer.setPixelRatio(Math.min(pixelRatioCap, window.devicePixelRatio || 1));
  renderer.setSize(viewport.width, viewport.height);

  const enableShadows = visuals.enableShadows === true;
  renderer.shadowMap.enabled = enableShadows;
  if (mainLight) mainLight.castShadow = enableShadows;
  if (sunLight) sunLight.castShadow = enableShadows;

  // Update existing meshes without requiring a full rebuild.
  const toggleShadow = (mesh) => {
    if (!mesh) return;
    mesh.castShadow = enableShadows;
    mesh.receiveShadow = enableShadows;
    const inner = mesh.userData?.shellInner;
    if (inner) {
      inner.castShadow = enableShadows;
      inner.receiveShadow = enableShadows;
    }
  };
  for (const mesh of toArray(state.fileMeshes)) toggleShadow(mesh);
  for (const mesh of toArray(state.fileInstancedMeshes)) toggleShadow(mesh);
  for (const mesh of toArray(state.fileInstancedInnerMeshes)) toggleShadow(mesh);
  for (const mesh of toArray(state.memberMeshes)) toggleShadow(mesh);
  for (const mesh of toArray(state.memberInstancedMeshes)) toggleShadow(mesh);
  for (const mesh of toArray(state.chunkMeshes)) toggleShadow(mesh);
  if (state.grid) state.grid.receiveShadow = enableShadows;
};
