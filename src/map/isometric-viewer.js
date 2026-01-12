const escapeScript = (value) => String(value || '').replace(/<\/script/gi, '<\\/script');

export function renderIsometricHtml({
  mapModel,
  threeUrl,
  openUriTemplate,
  viewerConfig = {}
}) {
  const mapJson = escapeScript(JSON.stringify(mapModel || {}));
  const config = {
    threeUrl: threeUrl || '',
    openUriTemplate: openUriTemplate || '',
    ...viewerConfig
  };
  const configJson = escapeScript(JSON.stringify(config));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Code Map Isometric</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0f1115; color: #f0f0f0; font-family: "Segoe UI", Tahoma, sans-serif; }
  #app { position: relative; width: 100%; height: 100%; overflow: hidden; }
  #hud { position: absolute; top: 12px; left: 12px; background: rgba(15, 17, 21, 0.85); border: 1px solid rgba(255,255,255,0.12); padding: 10px 12px; border-radius: 8px; min-width: 240px; z-index: 2; }
  #hud h1 { font-size: 14px; margin: 0 0 6px; }
  #hud .meta { font-size: 12px; opacity: 0.8; }
  #hud .detail { margin-top: 8px; font-size: 12px; line-height: 1.4; }
  #hud .detail strong { display: block; font-size: 11px; text-transform: uppercase; opacity: 0.6; }
  #hud .controls { margin-top: 10px; font-size: 11px; opacity: 0.6; }
  #menu { position: absolute; right: 12px; top: 12px; background: rgba(15, 17, 21, 0.9); border: 1px solid rgba(255,255,255,0.12); padding: 10px 12px; border-radius: 8px; font-size: 11px; min-width: 190px; max-width: 240px; max-height: 80vh; overflow: auto; z-index: 2; pointer-events: auto; }
  #menu h2 { font-size: 12px; margin: 0 0 6px; }
  #menu .section { margin-bottom: 10px; }
  #menu label { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer; }
  #menu input { accent-color: #4b7bec; }
  #menu .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  canvas { display: block; outline: none; position: absolute; inset: 0; z-index: 1; }
</style>
</head>
<body>
<div id="app" tabindex="0">
  <div id="hud">
    <h1>Code Map Isometric</h1>
    <div class="meta" id="summary"></div>
    <div class="detail" id="selection">
      <strong>Selection</strong>
      <div id="selection-body">None</div>
    </div>
    <div class="controls">Click to focus. WASD to move. Scroll to zoom. Double click to open.</div>
  </div>
  <div id="menu">
    <h2>View</h2>
    <div class="section" id="menu-view"></div>
    <h2>Edges</h2>
    <div class="section" id="menu-edges"></div>
  </div>
</div>
<script type="application/json" id="map-data">${mapJson}</script>
<script type="application/json" id="viewer-config">${configJson}</script>
<script type="module">
const map = JSON.parse(document.getElementById('map-data').textContent || '{}');
const config = JSON.parse(document.getElementById('viewer-config').textContent || '{}');
const app = document.getElementById('app');
const selectionBody = document.getElementById('selection-body');
const summary = document.getElementById('summary');
const menuView = document.getElementById('menu-view');
const menuEdges = document.getElementById('menu-edges');

if (!config.threeUrl) {
  selectionBody.textContent = 'Missing three.js module reference.';
  throw new Error('threeUrl missing');
}

(async () => {
  const THREE = await import(config.threeUrl);

  const counts = map.summary?.counts || { files: 0, members: 0, edges: 0 };
  summary.textContent = 'files: ' + (counts.files || 0)
    + ' | members: ' + (counts.members || 0)
    + ' | edges: ' + (counts.edges || 0);

  const getViewport = () => {
    const rect = app.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    return { width, height };
  };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const initialViewport = getViewport();
  renderer.setSize(initialViewport.width, initialViewport.height);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1115');

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 80, 30);
  scene.add(dirLight);

  const layoutDefaults = {
    groupDepth: 1,
    groupSpacing: 24,
    fileSpacing: 12,
    baseSize: 6,
    fileHeight: 1.4,
    memberCell: 1.2,
    memberGap: 0.35,
    memberInset: 0.7,
    memberHeightBase: 0.8,
    memberHeightScale: 0.5,
    memberHeightMax: 6,
    edgeLift: 0.2
  };
  const layout = { ...layoutDefaults, ...(config.layout || {}) };
  const files = Array.isArray(map.nodes) ? map.nodes : [];

  const fileMeshes = [];
  const memberMeshes = [];
  const fileAnchors = new Map();
  const memberAnchors = new Map();

  const fileGroup = new THREE.Group();
  const memberGroup = new THREE.Group();
  const labelGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  scene.add(fileGroup);
  scene.add(memberGroup);
  scene.add(labelGroup);
  scene.add(edgeGroup);

  const colorPalette = {
    source: 0x2980b9,
    test: 0x8e44ad,
    config: 0x16a085,
    docs: 0xd35400,
    generated: 0x7f8c8d,
    dir: 0x34495e,
    other: 0x2c3e50
  };

  const numberValue = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const groupDepth = Math.max(0, Math.floor(numberValue(layout.groupDepth, layoutDefaults.groupDepth)));
  const baseSize = numberValue(layout.baseSize, layoutDefaults.baseSize);
  const fileHeight = numberValue(layout.fileHeight, layoutDefaults.fileHeight);
  const memberCell = numberValue(layout.memberCell, layoutDefaults.memberCell);
  const memberGap = numberValue(layout.memberGap, layoutDefaults.memberGap);
  const memberInset = numberValue(layout.memberInset, layoutDefaults.memberInset);
  const fileSpacing = numberValue(layout.fileSpacing ?? layout.spacing, layoutDefaults.fileSpacing);
  const groupSpacing = numberValue(layout.groupSpacing, layoutDefaults.groupSpacing);

  const splitPath = (value) => String(value || '').split('/').filter(Boolean);
  const groupKeyForPath = (filePath) => {
    const segments = splitPath(filePath);
    if (!segments.length || groupDepth === 0) return '(root)';
    return segments.slice(0, groupDepth).join('/');
  };

  const scoreMember = (member) => {
    let score = 0;
    const dataflow = member?.dataflow || {};
    const flowLists = [dataflow.reads, dataflow.writes, dataflow.mutations, dataflow.aliases];
    for (const list of flowLists) {
      if (Array.isArray(list)) score += list.length;
    }
    const control = member?.controlFlow || {};
    for (const value of Object.values(control)) {
      if (Array.isArray(value)) score += value.length;
      else if (typeof value === 'number') score += value;
      else if (value) score += 1;
    }
    return score;
  };

  const memberHeight = (member) => {
    const base = numberValue(layout.memberHeightBase, layoutDefaults.memberHeightBase);
    const scale = numberValue(layout.memberHeightScale, layoutDefaults.memberHeightScale);
    const max = numberValue(layout.memberHeightMax, layoutDefaults.memberHeightMax);
    const height = base + scoreMember(member) * scale;
    return Math.max(base, Math.min(max, height));
  };

  const computeGrid = (count) => {
    if (!count) return { columns: 0, rows: 0 };
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    return { columns, rows };
  };

  const createTextSprite = (text) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const fontSize = 28;
    const fontFamily = 'Segoe UI, sans-serif';
    context.font = fontSize + 'px ' + fontFamily;
    const metrics = context.measureText(text);
    const paddingX = 12;
    const paddingY = 6;
    const width = Math.ceil(metrics.width + paddingX * 2);
    const height = fontSize + paddingY * 2;
    canvas.width = width;
    canvas.height = height;
    context.font = fontSize + 'px ' + fontFamily;
    context.fillStyle = 'rgba(15, 17, 21, 0.55)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.strokeRect(0.5, 0.5, width - 1, height - 1);
    context.fillStyle = '#f1f2f6';
    context.textBaseline = 'middle';
    context.fillText(text, paddingX, height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    const scale = 0.02;
    sprite.scale.set(width * scale, height * scale, 1);
    sprite.center.set(0, 0.5);
    return sprite;
  };

  const isClassMember = (member) => {
    if (!member) return false;
    if (member.type === 'class') return true;
    const kind = String(member.kind || '').toLowerCase();
    return kind.includes('class') || kind.includes('interface') || kind.includes('struct');
  };

  const buildSlots = (width, depth, columns, rows) => {
    if (!columns || !rows) return [];
    const slots = [];
    const startX = -width / 2 + memberInset + memberCell / 2;
    const startZ = -depth / 2 + memberInset + memberCell / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const x = startX + col * (memberCell + memberGap);
        const z = startZ + row * (memberCell + memberGap);
        slots.push({ x, z, sort: x + z });
      }
    }
    return slots.sort((a, b) => (a.sort - b.sort) || (a.x - b.x) || (a.z - b.z));
  };

  const groupsByKey = new Map();

  for (const node of files) {
    const members = Array.isArray(node.members) ? node.members : [];
    const grid = computeGrid(members.length);
    let width = baseSize;
    let depth = baseSize;
    if (members.length) {
      width = Math.max(baseSize, grid.columns * memberCell + (grid.columns - 1) * memberGap + memberInset * 2);
      depth = Math.max(baseSize, grid.rows * memberCell + (grid.rows - 1) * memberGap + memberInset * 2);
    }
    const fileLayout = {
      node,
      width,
      depth,
      height: fileHeight,
      columns: grid.columns,
      rows: grid.rows,
      memberSlots: buildSlots(width, depth, grid.columns, grid.rows),
      members: members.map((member) => ({ member, height: memberHeight(member) }))
    };
    const key = groupKeyForPath(node.path || node.name || '');
    const group = groupsByKey.get(key) || { key, files: [] };
    group.files.push(fileLayout);
    groupsByKey.set(key, group);
  }

  const groups = Array.from(groupsByKey.values()).sort((a, b) => a.key.localeCompare(b.key));
  for (const group of groups) {
    group.files.sort((a, b) => String(a.node.path || '').localeCompare(String(b.node.path || '')));
    const maxWidth = group.files.reduce((acc, file) => Math.max(acc, file.width), baseSize);
    const maxDepth = group.files.reduce((acc, file) => Math.max(acc, file.depth), baseSize);
    const columns = Math.max(1, Math.ceil(Math.sqrt(group.files.length || 1)));
    const rows = Math.max(1, Math.ceil((group.files.length || 1) / columns));
    const strideX = maxWidth + fileSpacing;
    const strideZ = maxDepth + fileSpacing;
    group.width = columns * strideX - fileSpacing;
    group.depth = rows * strideZ - fileSpacing;
    group.files.forEach((fileLayout, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      fileLayout.x = col * strideX;
      fileLayout.z = row * strideZ;
    });
  }

  const groupCount = Math.max(1, groups.length);
  const groupColumns = Math.ceil(Math.sqrt(groupCount));
  const maxGroupWidth = groups.reduce((acc, group) => Math.max(acc, group.width || 0), baseSize);
  const maxGroupDepth = groups.reduce((acc, group) => Math.max(acc, group.depth || 0), baseSize);
  const groupStrideX = maxGroupWidth + groupSpacing;
  const groupStrideZ = maxGroupDepth + groupSpacing;

  groups.forEach((group, index) => {
    const row = Math.floor(index / groupColumns);
    const col = index % groupColumns;
    const offsetX = col * groupStrideX;
    const offsetZ = row * groupStrideZ;
    for (const fileLayout of group.files) {
      fileLayout.x += offsetX;
      fileLayout.z += offsetZ;
    }
  });

  const allFiles = groups.flatMap((group) => group.files);
  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  if (allFiles.length) {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (const fileLayout of allFiles) {
      const left = fileLayout.x - fileLayout.width / 2;
      const right = fileLayout.x + fileLayout.width / 2;
      const back = fileLayout.z - fileLayout.depth / 2;
      const front = fileLayout.z + fileLayout.depth / 2;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minZ = Math.min(minZ, back);
      maxZ = Math.max(maxZ, front);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    for (const fileLayout of allFiles) {
      fileLayout.x -= centerX;
      fileLayout.z -= centerZ;
    }
    minX -= centerX;
    maxX -= centerX;
    minZ -= centerZ;
    maxZ -= centerZ;
  }

  const spanX = Math.max(40, maxX - minX);
  const spanZ = Math.max(40, maxZ - minZ);
  const maxSpan = Math.max(spanX, spanZ);
  const gridSize = Math.max(80, Math.ceil(maxSpan * 1.4 / 10) * 10);
  const gridDivisions = Math.max(10, Math.round(gridSize / 5));
  const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x222831, 0x222831);
  scene.add(grid);

  const cameraBase = Math.max(40, maxSpan * 0.6);
  const cameraDistance = Math.max(60, maxSpan * 1.2);
  const farPlane = Math.max(5000, maxSpan * 10);
  const nearPlane = Math.max(0.1, farPlane / 100000);
  const camera = new THREE.OrthographicCamera(-cameraBase, cameraBase, cameraBase, -cameraBase, nearPlane, farPlane);
  camera.position.set(cameraDistance, cameraDistance * 0.9, cameraDistance);
  camera.lookAt(0, 0, 0);

  for (const fileLayout of allFiles) {
    const node = fileLayout.node;
    const geometry = new THREE.BoxGeometry(fileLayout.width, fileLayout.height, fileLayout.depth);
    const color = colorPalette[node.category] || colorPalette.other;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(fileLayout.x, fileLayout.height / 2, fileLayout.z);
    mesh.userData = { type: 'file', file: node.path || node.name, name: node.name, range: null };
    fileGroup.add(mesh);
    fileMeshes.push(mesh);
    const fileKey = node.path || node.name;
    if (fileKey) {
      fileAnchors.set(fileKey, { x: mesh.position.x, y: fileLayout.height, z: mesh.position.z });
    }

    const slots = fileLayout.memberSlots;
    if (!slots.length) continue;
    const members = fileLayout.members.slice().sort((a, b) => b.height - a.height);
    const memberMaterial = new THREE.MeshStandardMaterial({ color: 0xecf0f1, roughness: 0.4, metalness: 0.1 });
    members.forEach((entry, index) => {
      const slot = slots[index];
      if (!slot) return;
      const height = entry.height;
      const mGeom = new THREE.BoxGeometry(memberCell, height, memberCell);
      const mMesh = new THREE.Mesh(mGeom, memberMaterial);
      mMesh.position.set(fileLayout.x + slot.x, fileLayout.height / 2 + height / 2 + 0.05, fileLayout.z + slot.z);
      mMesh.userData = {
        type: 'member',
        file: node.path || node.name,
        name: entry.member.name,
        range: entry.member.range || null
      };
      memberGroup.add(mMesh);
      memberMeshes.push(mMesh);
      if (entry.member.id) {
        memberAnchors.set(entry.member.id, {
          x: mMesh.position.x,
          y: mMesh.position.y + height / 2,
          z: mMesh.position.z
        });
      }
      if (isClassMember(entry.member) && entry.member.name) {
        const label = createTextSprite(entry.member.name);
        label.position.set(
          mMesh.position.x + memberCell / 2 + 0.6,
          mMesh.position.y,
          mMesh.position.z
        );
        labelGroup.add(label);
      }
    });
  }

  const edgeStyles = map.legend?.edgeStyles || {};
  const edgeSegments = new Map();
  const edgeTypeGroups = new Map();
  const edgeLift = numberValue(layout.edgeLift, layoutDefaults.edgeLift);

  const resolveAnchor = (endpoint) => {
    if (!endpoint) return null;
    if (endpoint.member && memberAnchors.has(endpoint.member)) return memberAnchors.get(endpoint.member);
    if (endpoint.file && fileAnchors.has(endpoint.file)) return fileAnchors.get(endpoint.file);
    return null;
  };

  const edges = Array.isArray(map.edges) ? map.edges : [];
  for (const edge of edges) {
    const start = resolveAnchor(edge.from);
    const end = resolveAnchor(edge.to);
    if (!start || !end) continue;
    const type = edge.type || 'other';
    const list = edgeSegments.get(type) || [];
    list.push(start.x, start.y + edgeLift, start.z);
    list.push(end.x, end.y + edgeLift, end.z);
    edgeSegments.set(type, list);
  }

  const makeEdgeMaterial = (style) => {
    const color = style?.color || '#9aa0a6';
    const mode = style?.style || 'solid';
    if (mode === 'dashed' || mode === 'dotted' || mode === 'dashdot') {
      const dashSize = mode === 'dotted' ? 0.6 : 1.2;
      const gapSize = mode === 'dashdot' ? 0.5 : 0.9;
      return new THREE.LineDashedMaterial({
        color: new THREE.Color(color),
        dashSize,
        gapSize,
        transparent: true,
        opacity: 0.75
      });
    }
    return new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.75
    });
  };

  for (const [type, points] of edgeSegments.entries()) {
    if (points.length < 6) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = makeEdgeMaterial(edgeStyles[type]);
    const line = new THREE.LineSegments(geometry, material);
    if (material.isLineDashedMaterial) line.computeLineDistances();
    edgeGroup.add(line);
    edgeTypeGroups.set(type, line);
  }

  const createToggle = (container, options) => {
    const wrapper = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = options.checked !== false;
    input.addEventListener('change', () => options.onChange(input.checked));
    wrapper.appendChild(input);
    if (options.swatch) wrapper.appendChild(options.swatch);
    const text = document.createElement('span');
    text.textContent = options.label;
    wrapper.appendChild(text);
    container.appendChild(wrapper);
  };

  createToggle(menuView, { label: 'Grid', onChange: (value) => { grid.visible = value; } });
  createToggle(menuView, { label: 'Files', onChange: (value) => { fileGroup.visible = value; } });
  createToggle(menuView, { label: 'Members', onChange: (value) => { memberGroup.visible = value; } });
  createToggle(menuView, { label: 'Labels', onChange: (value) => { labelGroup.visible = value; } });
  createToggle(menuView, { label: 'Edges', onChange: (value) => { edgeGroup.visible = value; } });

  const edgeTypes = Array.from(edgeSegments.keys()).sort((a, b) => a.localeCompare(b));
  if (!edgeTypes.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No edges available';
    menuEdges.appendChild(empty);
  } else {
    edgeTypes.forEach((type) => {
      const style = edgeStyles[type] || {};
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = style.color || '#9aa0a6';
      const line = edgeTypeGroups.get(type);
      createToggle(menuEdges, {
        label: type,
        swatch,
        onChange: (value) => {
          if (line) line.visible = value;
        }
      });
    });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected = null;
  let dragging = false;
  let dragMoved = false;
  let lastPointer = { x: 0, y: 0 };
  const controls = config.controls || {};

  const setSelection = (object) => {
    if (selected && selected.material) {
      selected.material.emissive?.setHex(0x000000);
    }
    selected = object;
    if (selected && selected.material) {
      selected.material.emissive = new THREE.Color(0x333333);
    }
    if (!selected) {
      selectionBody.textContent = 'None';
      return;
    }
    const info = selected.userData || {};
    const range = info.range || {};
    const line = range.startLine || 1;
    const endLine = range.endLine || line;
    selectionBody.textContent = (info.name || info.file) + ' (' + info.file
      + ':' + line + '-' + endLine + ')';
  };

  const resolveFilePath = (file) => {
    if (!file) return '';
    if (file.includes(':\\\\') || file.startsWith('\\\\') || file.startsWith('/')) return file;
    const root = map.root?.path || '';
    if (!root) return file;
    if (root.endsWith('/') || root.endsWith('\\\\')) return root + file;
    return root + '/' + file;
  };

  const buildOpenUri = (info) => {
    if (!config.openUriTemplate) return null;
    const range = info.range || {};
    const filePath = resolveFilePath(info.file || '');
    const replacements = {
      file: encodeURIComponent(filePath),
      fileRaw: filePath,
      line: encodeURIComponent(range.startLine || 1),
      column: encodeURIComponent(1),
      startLine: encodeURIComponent(range.startLine || 1),
      endLine: encodeURIComponent(range.endLine || range.startLine || 1),
      symbol: encodeURIComponent(info.name || '')
    };
    return config.openUriTemplate.replace(/{(\w+)}/g, (match, key) => replacements[key] || match);
  };

  const openSelection = () => {
    if (!selected) return;
    const uri = buildOpenUri(selected.userData || {});
    if (uri) window.location.href = uri;
  };

  const onPointer = (event) => {
    if (dragMoved) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...memberMeshes, ...fileMeshes]);
    if (hits.length) {
      setSelection(hits[0].object);
    } else {
      setSelection(null);
    }
  };

  const startDrag = (event) => {
    if (event.button !== 0) return;
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
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const viewWidth = (camera.right - camera.left) / camera.zoom;
    const viewHeight = (camera.top - camera.bottom) / camera.zoom;
    const unitsX = viewWidth / rect.width;
    const unitsZ = viewHeight / rect.height;
    const panSensitivity = controls.panSensitivity || 1.5;
    camera.position.x -= dx * unitsX * panSensitivity;
    camera.position.z += dy * unitsZ * panSensitivity;
  };

  const endDrag = () => {
    dragging = false;
  };

  renderer.domElement.addEventListener('pointerdown', startDrag);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointerleave', endDrag);

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
  app.addEventListener('pointerdown', () => {
    focused = true;
    app.focus();
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

  const wasd = controls.wasd || { sensitivity: 160, acceleration: 60, maxSpeed: 240, drag: 6 };
  const velocity = new THREE.Vector2(0, 0);

  const updateCamera = (dt) => {
    const accel = wasd.acceleration || 30;
    const maxSpeed = wasd.maxSpeed || 60;
    const drag = wasd.drag || 6;
    const sensitivity = wasd.sensitivity || 16;

    if (keys.KeyW) velocity.y -= accel * dt;
    if (keys.KeyS) velocity.y += accel * dt;
    if (keys.KeyA) velocity.x -= accel * dt;
    if (keys.KeyD) velocity.x += accel * dt;

    velocity.x -= velocity.x * drag * dt;
    velocity.y -= velocity.y * drag * dt;
    velocity.x = Math.max(-maxSpeed, Math.min(maxSpeed, velocity.x));
    velocity.y = Math.max(-maxSpeed, Math.min(maxSpeed, velocity.y));

    camera.position.x += velocity.x * dt * sensitivity * 0.05;
    camera.position.z += velocity.y * dt * sensitivity * 0.05;
  };

  renderer.domElement.addEventListener('wheel', (event) => {
    const zoomSensitivity = controls.zoomSensitivity || 0.1;
    const delta = event.deltaY > 0 ? -1 : 1;
    camera.zoom = Math.max(0.2, Math.min(6, camera.zoom + delta * zoomSensitivity));
    camera.updateProjectionMatrix();
  });

  let lastTime = performance.now();
  const animate = () => {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    updateCamera(dt);
    renderer.render(scene, camera);
  };
  animate();

  const onResize = () => {
    const viewport = getViewport();
    const aspect = viewport.width / viewport.height;
    const base = cameraBase;
    camera.left = -base * aspect;
    camera.right = base * aspect;
    camera.top = base;
    camera.bottom = -base;
    camera.near = nearPlane;
    camera.far = farPlane;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(viewport.width, viewport.height);
  };
  window.addEventListener('resize', onResize);
  onResize();
})();
</script>
</body>
</html>`;
}
