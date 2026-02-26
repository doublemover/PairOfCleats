import { state } from './state.js';
import { clamp } from './utils.js';
import { toArray } from '../../../shared/iterables.js';
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
      const memberKey = endpoint.member === 0 || endpoint.member ? String(endpoint.member) : null;
      const member = memberKey ? (state.memberById.get(memberKey) || state.memberById.get(endpoint.member)) : null;
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
    const fromMemberId = from.member === 0 || from.member ? String(from.member) : null;
    const toMemberId = to.member === 0 || to.member ? String(to.member) : null;
    const fromMemberFile = fromMemberId ? (state.fileByMember.get(fromMemberId) || state.fileByMember.get(from.member)) : null;
    const toMemberFile = toMemberId ? (state.fileByMember.get(toMemberId) || state.fileByMember.get(to.member)) : null;

    const fromMatch = memberId
      ? (fromMemberId === String(memberId))
      : (from.file === fileKey || fromMemberFile === fileKey);
    const toMatch = memberId
      ? (toMemberId === String(memberId))
      : (to.file === fileKey || toMemberFile === fileKey);
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
  const rawMemberId = (info.type === 'member' ? (info.id ?? info.memberId ?? null) : (info.memberId ?? null));
  const memberId = rawMemberId !== null && rawMemberId !== undefined ? String(rawMemberId) : null;
  const member = memberId
    ? (memberById.get(memberId) || memberById.get(rawMemberId))
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


const resolveHitInfo = (hit) => {
  if (!hit) return null;
  const obj = hit.object || hit;
  if (!obj) return null;

  // Instanced members store per-instance metadata in userData.instanceInfo.
  if (obj.isInstancedMesh && hit.instanceId != null) {
    const info = obj.userData?.instanceInfo?.[hit.instanceId] || null;
    return info;
  }

  return obj.userData || null;
};

const setMemberInstanceTint = (memberId, color) => {
  if (!memberId) return;
  const key = String(memberId);
  const ref = state.memberInstanceById?.get(key) || null;
  if (!ref || !ref.mesh || ref.instanceId == null) return;

  ref.mesh.setColorAt(ref.instanceId, color);
  if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
};

const setFileInstanceTint = (fileKey, color) => {
  if (!fileKey) return;
  const ref = state.fileInstanceByKey?.get(fileKey) || null;
  if (!ref || !ref.mesh || ref.instanceId == null) return;
  ref.mesh.setColorAt(ref.instanceId, color);
  if (ref.mesh.instanceColor) ref.mesh.instanceColor.needsUpdate = true;
};

const resetMemberInstanceHighlights = () => {
  const highlighted = state.highlightedMemberIds;
  if (!highlighted || !highlighted.size) return;

  const white = new state.THREE.Color(0xffffff);
  for (const memberId of highlighted) {
    const base = state.memberColorById?.get(memberId) || white;
    setMemberInstanceTint(memberId, base);
  }
  highlighted.clear();
};

const resetFileInstanceHighlights = () => {
  const highlighted = state.highlightedFileKeys;
  if (!highlighted || !highlighted.size) return;

  const white = new state.THREE.Color(0xffffff);
  for (const fileKey of highlighted) {
    const base = state.fileColorByPath?.get(fileKey) || white;
    setFileInstanceTint(fileKey, base);
  }
  highlighted.clear();
};

const resetObjectHighlights = () => {
  for (const mesh of [...toArray(state.fileMeshes), ...toArray(state.memberMeshes), ...toArray(state.chunkMeshes)]) {
    if (!mesh) continue;
    resetMaterialHighlight(mesh.material);
    const inner = mesh.userData?.shellInner;
    if (inner?.material) resetMaterialHighlight(inner.material);
  }

  // Restore any per-instance tints applied to instanced members.
  resetMemberInstanceHighlights();
  resetFileInstanceHighlights();
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

const boostWireframeByKey = (fileKey, color, strength) => {
  if (!fileKey) return;
  const wire = state.fileWireByKey?.get(fileKey);
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

  const rawMemberId = (info.id ?? info.memberId ?? null);
  if (rawMemberId !== null && rawMemberId !== undefined && rawMemberId !== '') {
    const memberId = String(rawMemberId);
    keys.add(`member:${memberId}`);

    // fileByMember keys may be stored as strings or numbers depending on ingestion.
    const memberFile = state.fileByMember?.get(memberId) || state.fileByMember?.get(rawMemberId);
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
    if (type === 'file') {
      if (state.fileInstanceByKey?.has(id)) {
        const tint = color.clone().lerp(new state.THREE.Color(0xffffff), 0.2);
        setFileInstanceTint(id, tint);
        state.highlightedFileKeys?.add(id);
        boostWireframeByKey(id, tint, 0.2 * intensity);
      } else if (state.fileMeshByKey.has(id)) {
        highlightMesh(state.fileMeshByKey.get(id), color, 0.35 * intensity + 0.15, 0.25 * intensity);
      }
    }
    if (type === 'member') {
      // Instanced members: tint the instance temporarily.
      const tint = color.clone().lerp(new state.THREE.Color(0xffffff), 0.2);
      setMemberInstanceTint(id, tint);
      if (state.highlightedMemberIds) state.highlightedMemberIds.add(String(id));
    }
  });
};

export const applyHighlights = () => {
  resetObjectHighlights();
  resetEdgeHighlights();
  resetWireHighlights();

  const white = new state.THREE.Color(0xffffff);

  const selectedHit = state.selected;
  const selectedObj = selectedHit?.object || null;
  const selectedInfo = resolveHitInfo(selectedHit);
  const selectionKeys = buildSelectionKeys(selectedInfo);

  if (selectedHit && selectedObj) {
    if (selectedObj.isInstancedMesh && selectedHit.instanceId != null) {
      if (selectedInfo?.type === 'file') {
        const fileKey = selectedInfo?.file || selectedInfo?.name;
        const base = (fileKey && state.fileColorByPath?.get(fileKey)) || selectedInfo?.baseColor || white;
        const tint = base.clone().lerp(white, 0.35);
        if (fileKey) {
          setFileInstanceTint(fileKey, tint);
          state.highlightedFileKeys?.add(fileKey);
          boostWireframeByKey(fileKey, tint, 0.25);
        }
      } else {
        const memberId = selectedInfo?.id ? String(selectedInfo.id) : null;
        const base = (memberId && state.memberColorById?.get(memberId)) || selectedInfo?.baseColor || white;
        const tint = base.clone().lerp(white, 0.45);
        if (memberId) {
          setMemberInstanceTint(memberId, tint);
          state.highlightedMemberIds?.add(memberId);
        }
      }
    } else {
      const baseColor = selectedObj.userData?.baseColor
        ? selectedObj.userData.baseColor
        : (selectedObj.material?.color ? selectedObj.material.color : white);
      highlightMesh(selectedObj, baseColor.clone().lerp(white, 0.35), 0.7, 0.85);
    }

    applyHighlightsForKeys(selectionKeys, 1);
  }

  if (state.hoveredRef) {
    const hoverInfo = state.hoveredRef.refType === 'member'
      ? { type: 'member', id: String(state.hoveredRef.refId), memberId: String(state.hoveredRef.refId) }
      : { type: 'file', file: state.hoveredRef.refId, name: state.hoveredRef.refId };

    const hoverKeys = buildSelectionKeys(hoverInfo);
    applyHighlightsForKeys(hoverKeys, 0.6);

    if (state.hoveredRef.refType === 'file') {
      const fileKey = state.hoveredRef.refId;
      if (state.fileInstanceByKey?.has(fileKey)) {
        setFileInstanceTint(fileKey, white);
        state.highlightedFileKeys?.add(fileKey);
        boostWireframeByKey(fileKey, white, 0.2);
      } else if (state.fileMeshByKey.has(fileKey)) {
        highlightMesh(state.fileMeshByKey.get(fileKey), white, 0.35, 0.35);
      }
    }

    if (state.hoveredRef.refType === 'member') {
      const memberId = String(state.hoveredRef.refId);
      const base = state.memberColorById?.get(memberId) || white;
      const tint = base.clone().lerp(white, 0.25);
      setMemberInstanceTint(memberId, tint);
      state.highlightedMemberIds?.add(memberId);
    }
  }

  const hoveredHit = state.hovered;
  if (hoveredHit && !state.selected) {
    const hoveredObj = hoveredHit.object || null;
    if (hoveredObj) {
      if (hoveredObj.isInstancedMesh && hoveredHit.instanceId != null) {
        const hoverInfo = resolveHitInfo(hoveredHit);
        if (hoverInfo?.type === 'file') {
          const fileKey = hoverInfo?.file || hoverInfo?.name;
          const base = (fileKey && state.fileColorByPath?.get(fileKey)) || hoverInfo?.baseColor || white;
          const tint = base.clone().lerp(white, 0.25);
          if (fileKey) {
            setFileInstanceTint(fileKey, tint);
            state.highlightedFileKeys?.add(fileKey);
            boostWireframeByKey(fileKey, tint, 0.2);
          }
        } else {
          const memberId = hoverInfo?.id ? String(hoverInfo.id) : null;
          const base = (memberId && state.memberColorById?.get(memberId)) || hoverInfo?.baseColor || white;
          const tint = base.clone().lerp(white, 0.25);
          if (memberId) {
            setMemberInstanceTint(memberId, tint);
            state.highlightedMemberIds?.add(memberId);
          }
        }
      } else {
        const baseColor = hoveredObj.userData?.baseColor
          ? hoveredObj.userData.baseColor.clone().lerp(white, 0.25)
          : white;
        highlightMesh(hoveredObj, baseColor, 0.35, 0.4);
      }
    }
  }
};

export const setSelection = (hit) => {
  state.selected = hit;
  const info = resolveHitInfo(hit);
  state.selectedInfo = info || null;
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
    fileRaw: encodeURIComponent(filePath),
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
  const info = resolveHitInfo(state.selected);
  const uri = buildOpenUri(info || {});
  if (uri) window.location.href = uri;
};


