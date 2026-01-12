import { state } from './state.js';
import { clamp } from './utils.js';
import { configureWireMaterial } from './materials.js';

const formatPrimitive = (value) => {
  if (value === null || value === undefined || value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : 'None';
  return String(value);
};

const isRefItem = (value) => value && typeof value === 'object' && value.__ref;

export const setHoverRef = (ref) => {
  state.hoveredRef = ref;
  applyHighlights();
};

const renderValueNode = (value) => {
  if (value === null || value === undefined || value === '') {
    const empty = document.createElement('span');
    empty.className = 'sel-empty';
    empty.textContent = 'None';
    return empty;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      const empty = document.createElement('span');
      empty.className = 'sel-empty';
      empty.textContent = 'None';
      return empty;
    }
    const list = document.createElement('div');
    list.className = 'sel-list';
    value.forEach((entry) => {
      const pill = document.createElement('span');
      pill.className = 'sel-pill';
      if (isRefItem(entry)) {
        pill.textContent = entry.label;
        pill.dataset.refType = entry.refType;
        pill.dataset.refId = entry.refId;
        pill.addEventListener('mouseenter', () => setHoverRef(entry));
        pill.addEventListener('mouseleave', () => setHoverRef(null));
      } else {
        pill.textContent = formatPrimitive(entry);
      }
      list.appendChild(pill);
    });
    return list;
  }
  if (typeof value === 'object') {
    if (isRefItem(value)) {
      const pill = document.createElement('span');
      pill.className = 'sel-pill';
      pill.textContent = value.label;
      pill.dataset.refType = value.refType;
      pill.dataset.refId = value.refId;
      pill.addEventListener('mouseenter', () => setHoverRef(value));
      pill.addEventListener('mouseleave', () => setHoverRef(null));
      return pill;
    }
    const entries = Object.entries(value);
    if (!entries.length) {
      const empty = document.createElement('span');
      empty.className = 'sel-empty';
      empty.textContent = 'None';
      return empty;
    }
    const list = document.createElement('div');
    list.className = 'sel-list';
    entries.forEach(([key, entry]) => {
      const pill = document.createElement('span');
      pill.className = 'sel-pill';
      pill.textContent = `${key}: ${formatPrimitive(entry)}`;
      list.appendChild(pill);
    });
    return list;
  }
  const text = document.createElement('span');
  text.textContent = formatPrimitive(value);
  return text;
};

const createSelectionSection = (title) => {
  const { dom } = state;
  const section = document.createElement('div');
  section.className = 'sel-section';
  const heading = document.createElement('div');
  heading.className = 'sel-title';
  heading.textContent = title;
  section.appendChild(heading);
  dom.selectionBody.appendChild(section);
  return section;
};

const addSelectionRow = (section, label, value) => {
  const row = document.createElement('div');
  row.className = 'sel-row';
  const labelNode = document.createElement('div');
  labelNode.className = 'sel-label';
  labelNode.textContent = label;
  const valueNode = document.createElement('div');
  valueNode.className = 'sel-value';
  valueNode.appendChild(renderValueNode(value));
  row.appendChild(labelNode);
  row.appendChild(valueNode);
  section.appendChild(row);
};

const formatRange = (range) => {
  if (!range || !Number.isFinite(range.startLine)) return 'None';
  const start = range.startLine;
  const end = Number.isFinite(range.endLine) ? range.endLine : start;
  const span = Math.max(1, end - start + 1);
  return `${start}-${end} (${span} lines)`;
};

const formatEdgeCounts = (edgeList) => {
  if (!edgeList.length) return [];
  const counts = new Map();
  edgeList.forEach((edge) => {
    const type = edge.type || 'other';
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type}: ${count}`);
};

const formatEdgeTargets = (edgeList, direction, limit = 8) => {
  if (!edgeList.length) return [];
  const seen = new Set();
  const targets = [];
  edgeList.forEach((edge) => {
    const endpoint = direction === 'incoming' ? edge.from : edge.to;
    if (!endpoint) return;
    let label = '';
    let refType = '';
    let refId = '';
    if (endpoint.member) {
      const member = state.memberById.get(endpoint.member);
      if (member) {
        label = `${member.name || endpoint.member} - ${member.file || ''}`.trim();
        refType = 'member';
        refId = member.id || endpoint.member;
      } else {
        label = endpoint.member;
        refType = 'member';
        refId = endpoint.member;
      }
    } else if (endpoint.file) {
      label = endpoint.file;
      refType = 'file';
      refId = endpoint.file;
    }
    if (!label || seen.has(label)) return;
    seen.add(label);
    targets.push({ __ref: true, label, refType, refId });
  });
  if (targets.length > limit) {
    const trimmed = targets.slice(0, limit);
    trimmed.push(`+${targets.length - limit} more`);
    return trimmed;
  }
  return targets;
};

const formatListWithLimit = (values, limit = 10) => {
  if (!Array.isArray(values) || !values.length) return [];
  if (values.length > limit) {
    return values.slice(0, limit).concat(`+${values.length - limit} more`);
  }
  return values;
};

const collectEdgesForSelection = (selectionInfo, member, node) => {
  if (!selectionInfo) return { incoming: [], outgoing: [] };
  const memberId = member?.id || selectionInfo.id || null;
  const fileKey = selectionInfo.file || node?.path || node?.name || '';
  const incoming = [];
  const outgoing = [];
  state.edges.forEach((edge) => {
    const from = edge.from || {};
    const to = edge.to || {};
    const fromMatch = memberId
      ? from.member === memberId
      : (from.file === fileKey || state.fileByMember.get(from.member) === fileKey);
    const toMatch = memberId
      ? to.member === memberId
      : (to.file === fileKey || state.fileByMember.get(to.member) === fileKey);
    if (fromMatch) outgoing.push(edge);
    if (toMatch) incoming.push(edge);
  });
  return { incoming, outgoing };
};

export const renderSelectionDetails = (info) => {
  const { dom, nodeByPath, nodeById, memberById, memberByKey, buildMemberKey, buildMemberNameKey } = state;
  dom.selectionBody.textContent = '';
  if (!info) {
    dom.selectionBody.textContent = 'None';
    return;
  }
  const fileKey = info.file || info.name || '';
  const node = nodeByPath.get(fileKey) || nodeById.get(info.id) || null;
  const rangeKey = buildMemberKey(fileKey, info.name || '', info.range || {});
  const nameKey = buildMemberNameKey(fileKey, info.name || '');
  const member = info.id
    ? memberById.get(info.id)
    : (memberByKey.get(rangeKey) || memberByKey.get(nameKey) || null);

  if (info.type === 'file' || (!info.type && node)) {
    const section = createSelectionSection('File');
    addSelectionRow(section, 'Name', node?.name || info.name || fileKey);
    addSelectionRow(section, 'Path', node?.path || fileKey);
    addSelectionRow(section, 'Category', node?.category || 'None');
    addSelectionRow(section, 'Type', node?.type || 'file');
    addSelectionRow(section, 'Ext', node?.ext || 'None');
    addSelectionRow(section, 'Id', node?.id || 'None');
    const members = Array.isArray(node?.members) ? node.members : [];
    addSelectionRow(section, 'Members', members.length);
    if (members.length) {
      const memberNames = members.map((entry) => entry.name).filter(Boolean);
      addSelectionRow(section, 'Member names', formatListWithLimit(memberNames, 10));
    }
  }

  if (info.type === 'member' || member) {
    const section = createSelectionSection('Member');
    addSelectionRow(section, 'Name', member?.name || info.name || 'None');
    addSelectionRow(section, 'File', member?.file || fileKey || 'None');
    addSelectionRow(section, 'Type', member?.type || info.type || 'None');
    addSelectionRow(section, 'Kind', member?.kind || 'None');
    addSelectionRow(section, 'Signature', member?.signature || 'None');
    addSelectionRow(section, 'Params', member?.params || null);
    addSelectionRow(section, 'Returns', member?.returns || 'None');
    addSelectionRow(section, 'Modifiers', member?.modifiers || 'None');
    addSelectionRow(section, 'Exported', member?.exported ?? false);
    addSelectionRow(section, 'Range', formatRange(member?.range || info.range));
    addSelectionRow(section, 'Id', member?.id || info.id || 'None');
    addSelectionRow(section, 'Port', member?.port || 'None');

    const dataflow = member?.dataflow || {};
    const dataSection = createSelectionSection('Dataflow');
    addSelectionRow(dataSection, 'Reads', dataflow.reads || null);
    addSelectionRow(dataSection, 'Writes', dataflow.writes || null);
    addSelectionRow(dataSection, 'Mutations', dataflow.mutations || null);
    addSelectionRow(dataSection, 'Aliases', dataflow.aliases || null);

    const controlFlow = member?.controlFlow || {};
    const controlSection = createSelectionSection('Control flow');
    addSelectionRow(controlSection, 'Branches', controlFlow.branches ?? 0);
    addSelectionRow(controlSection, 'Loops', controlFlow.loops ?? 0);
    addSelectionRow(controlSection, 'Returns', controlFlow.returns ?? 0);
    addSelectionRow(controlSection, 'Breaks', controlFlow.breaks ?? 0);
    addSelectionRow(controlSection, 'Continues', controlFlow.continues ?? 0);
    addSelectionRow(controlSection, 'Throws', controlFlow.throws ?? 0);
    addSelectionRow(controlSection, 'Awaits', controlFlow.awaits ?? 0);
    addSelectionRow(controlSection, 'Yields', controlFlow.yields ?? 0);
  }

  const edgeSection = createSelectionSection('Edges');
  const edgeData = collectEdgesForSelection(info, member, node);
  addSelectionRow(edgeSection, 'Incoming', formatEdgeCounts(edgeData.incoming));
  addSelectionRow(edgeSection, 'Outgoing', formatEdgeCounts(edgeData.outgoing));
  addSelectionRow(edgeSection, 'From', formatEdgeTargets(edgeData.incoming, 'incoming'));
  addSelectionRow(edgeSection, 'To', formatEdgeTargets(edgeData.outgoing, 'outgoing'));
};

const resetMaterialHighlight = (material) => {
  if (!material || !material.userData?.baseEmissive) return;
  material.emissive.copy(material.userData.baseEmissive);
  material.emissiveIntensity = material.userData.baseEmissiveIntensity ?? material.emissiveIntensity;
  if (material.userData.baseOpacity != null) material.opacity = material.userData.baseOpacity;
  material.needsUpdate = true;
};

const resetObjectHighlights = () => {
  for (const mesh of [...state.fileMeshes, ...state.memberMeshes, ...state.chunkMeshes]) {
    resetMaterialHighlight(mesh.material);
    const inner = mesh.userData?.shellInner;
    if (inner?.material) resetMaterialHighlight(inner.material);
  }
};

const resetEdgeHighlights = () => {
  for (const mesh of state.edgeMeshes) {
    const material = mesh.material;
    if (!material) continue;
    if (mesh.isInstancedMesh) {
      const baseColors = mesh.userData?.instanceBaseColors;
      if (Array.isArray(baseColors)) {
        baseColors.forEach((color, index) => {
          if (color) mesh.setColorAt(index, color);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (material.userData?.baseEmissiveIntensity != null) {
        material.emissiveIntensity = material.userData.baseEmissiveIntensity;
      }
      if (material.userData?.baseOpacity != null) {
        material.opacity = material.userData.baseOpacity;
      }
      material.needsUpdate = true;
      continue;
    }
    if (!material.userData?.baseColor) continue;
    material.color.copy(material.userData.baseColor);
    material.emissive.copy(material.userData.baseEmissive);
    material.emissiveIntensity = material.userData.baseEmissiveIntensity ?? material.emissiveIntensity;
    material.opacity = material.userData.baseOpacity ?? material.opacity;
    material.needsUpdate = true;
  }
};

const resetWireHighlights = () => {
  for (const material of state.wireMaterials) {
    configureWireMaterial(material);
    material.needsUpdate = true;
  }
};

const boostWireframe = (mesh, color, strength) => {
  if (!mesh) return;
  const wire = state.wireByMesh.get(mesh);
  if (!wire || !wire.material) return;
  const material = wire.material;
  const baseWidth = material.userData?.baseLinewidth || material.linewidth || 1;
  if ('linewidth' in material) {
    material.linewidth = baseWidth * (1 + strength);
  }
  if (color) material.color.copy(color);
  material.opacity = clamp(material.opacity + strength * 0.2, 0.02, 0.9);
  material.needsUpdate = true;
};

const highlightMesh = (mesh, color, intensity, wireBoost = 0) => {
  if (!mesh || !mesh.material) return;
  mesh.material.emissive.copy(color);
  mesh.material.emissiveIntensity = intensity;
  mesh.material.needsUpdate = true;
  const inner = mesh.userData?.shellInner;
  if (inner?.material) {
    inner.material.emissive.copy(color);
    inner.material.emissiveIntensity = intensity * 0.75;
    inner.material.needsUpdate = true;
  }
  if (wireBoost > 0) boostWireframe(mesh, color, wireBoost);
};

const highlightEdgeMesh = (mesh, color) => {
  if (!mesh || !mesh.material) return;
  mesh.material.color.copy(color);
  mesh.material.emissive.copy(color);
  mesh.material.emissiveIntensity = Math.max(0.6, mesh.material.userData?.baseEmissiveIntensity || 0.6);
  mesh.material.opacity = Math.max(0.7, mesh.material.opacity);
  mesh.material.needsUpdate = true;
};

const highlightEdgeInstance = (mesh, index, color) => {
  if (!mesh || !mesh.isInstancedMesh) return;
  if (typeof mesh.setColorAt === 'function') {
    mesh.setColorAt(index, color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
};

const buildSelectionKeys = (info) => {
  const keys = new Set();
  if (!info) return keys;
  const fileKey = info.file || info.name || '';
  if (fileKey) keys.add(`file:${fileKey}`);
  const memberId = info.id || info.memberId || null;
  if (memberId) {
    keys.add(`member:${memberId}`);
    const memberFile = state.fileByMember.get(memberId);
    if (memberFile) keys.add(`file:${memberFile}`);
  }
  return keys;
};

const applyHighlightsForKeys = (selectionKeys, intensity = 1) => {
  if (!selectionKeys || !selectionKeys.size) return;
  const connected = new Map();
  const edgeSegments = state.edgeSegments || [];
  edgeSegments.forEach((segment) => {
    const endpoints = segment.endpoints;
    if (!endpoints || !endpoints.size) return;
    let matches = false;
    for (const key of selectionKeys) {
      if (endpoints.has(key)) {
        matches = true;
        break;
      }
    }
    if (!matches) return;
    const edgeColor = segment.edgeColor || new state.THREE.Color(0xffffff);
    const highlightColor = segment.highlightColor || edgeColor;
    highlightEdgeInstance(segment.mesh, segment.index, highlightColor);
    endpoints.forEach((endpointKey) => {
      if (selectionKeys.has(endpointKey)) return;
      const entry = connected.get(endpointKey) || { color: new state.THREE.Color(0, 0, 0), weight: 0 };
      entry.color.add(edgeColor.clone().multiplyScalar(1));
      entry.weight += 1;
      connected.set(endpointKey, entry);
    });
  });

  connected.forEach((entry, endpointKey) => {
    if (!entry.weight) return;
    const color = entry.color.multiplyScalar(1 / entry.weight);
    const [type, id] = endpointKey.split(':');
    if (type === 'file' && state.fileMeshByKey.has(id)) {
      highlightMesh(state.fileMeshByKey.get(id), color, 0.35 * intensity + 0.15, 0.25 * intensity);
    }
    if (type === 'member' && state.memberMeshById.has(id)) {
      highlightMesh(state.memberMeshById.get(id), color, 0.35 * intensity + 0.15, 0.25 * intensity);
    }
  });
};

export const applyHighlights = () => {
  resetObjectHighlights();
  resetEdgeHighlights();
  resetWireHighlights();
  const selectionKeys = buildSelectionKeys(state.selected?.userData || null);
  if (state.selected) {
    const baseColor = state.selected.userData?.baseColor
      ? state.selected.userData.baseColor
      : (state.selected.material?.color ? state.selected.material.color : new state.THREE.Color(0xffffff));
    highlightMesh(state.selected, baseColor.clone().lerp(new state.THREE.Color(0xffffff), 0.35), 0.7, 0.85);
    applyHighlightsForKeys(selectionKeys, 1);
  }
  if (state.hoveredRef) {
    const hoverInfo = state.hoveredRef.refType === 'member'
      ? { id: state.hoveredRef.refId, memberId: state.hoveredRef.refId }
      : { file: state.hoveredRef.refId, name: state.hoveredRef.refId };
    const hoverKeys = buildSelectionKeys(hoverInfo);
    applyHighlightsForKeys(hoverKeys, 0.6);
    if (state.hoveredRef.refType === 'file' && state.fileMeshByKey.has(state.hoveredRef.refId)) {
      highlightMesh(state.fileMeshByKey.get(state.hoveredRef.refId), new state.THREE.Color(0xffffff), 0.35, 0.35);
    }
    if (state.hoveredRef.refType === 'member' && state.memberMeshById.has(state.hoveredRef.refId)) {
      highlightMesh(state.memberMeshById.get(state.hoveredRef.refId), new state.THREE.Color(0xffffff), 0.35, 0.35);
    }
  }
  if (state.hoveredMesh && !state.selected) {
    const baseColor = state.hoveredMesh.userData?.baseColor
      ? state.hoveredMesh.userData.baseColor.clone().lerp(new state.THREE.Color(0xffffff), 0.25)
      : new state.THREE.Color(0xffffff);
    highlightMesh(state.hoveredMesh, baseColor, 0.35, 0.4);
  }
};

export const setSelection = (object) => {
  state.selected = object;
  const info = state.selected ? (state.selected.userData || {}) : null;
  renderSelectionDetails(info);
  applyHighlights();
};

const resolveFilePath = (file) => {
  if (!file) return '';
  if (file.includes(':\\') || file.startsWith('\\') || file.startsWith('/')) return file;
  const root = state.map.root?.path || '';
  if (!root) return file;
  if (root.endsWith('/') || root.endsWith('\\')) return root + file;
  return root + '/' + file;
};

const buildOpenUri = (info) => {
  if (!state.config.openUriTemplate) return null;
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
  return state.config.openUriTemplate.replace(/{(\w+)}/g, (match, key) => replacements[key] || match);
};

export const openSelection = () => {
  if (!state.selected) return;
  const uri = buildOpenUri(state.selected.userData || {});
  if (uri) window.location.href = uri;
};

