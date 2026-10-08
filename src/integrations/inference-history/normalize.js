import { createHash } from 'node:crypto';

const hasOwn = (value, key) => Object.hasOwn(value, key);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownValue = (value, key) => isRecord(value) && hasOwn(value, key) ? value[key] : undefined;
const isId = (value) => typeof value === 'string' && value.trim().length > 0;
const isAssetPointer = (value) => typeof value === 'string'
  && /^(?:file-service|sediment|attachment):\/\//.test(value);

const invalidInput = () => {
  const error = new Error('Invalid inference history conversation input.');
  error.code = 'ERR_INFERENCE_HISTORY_INPUT';
  return error;
};

/**
 * Hash JSON data without constructing an object that could interpret special keys.
 * Object keys are sorted; arrays retain their source order. Non-JSON values and
 * accessors fail closed, and the iterative walk accepts deeply nested JSON.
 */
const visitCanonicalJson = (raw, append) => {
  const ancestors = new WeakSet();
  const stack = [{ value: raw }];
  while (stack.length) {
    const entry = stack.pop();
    if (hasOwn(entry, 'literal')) {
      append(entry.literal);
      continue;
    }
    if (entry.leave) {
      ancestors.delete(entry.leave);
      continue;
    }
    const { value } = entry;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      append(JSON.stringify(value));
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      append(JSON.stringify(value));
      continue;
    }
    if (typeof value !== 'object' || ancestors.has(value)) throw invalidInput();
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw invalidInput();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        throw invalidInput();
      }
      if (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
        throw invalidInput();
      }
    }
    ancestors.add(value);
    stack.push({ leave: value });
    stack.push({ literal: array ? ']' : '}' });
    if (array) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        if (!hasOwn(descriptors, String(index))) throw invalidInput();
        stack.push({ value: descriptors[index].value });
        if (index > 0) stack.push({ literal: ',' });
      }
    } else {
      const sorted = keys.sort();
      for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const key = sorted[index];
        stack.push({ value: descriptors[key].value });
        stack.push({ literal: ':' });
        stack.push({ literal: JSON.stringify(key) });
        if (index > 0) stack.push({ literal: ',' });
      }
    }
    stack.push({ literal: array ? '[' : '{' });
  }
};

export const canonicalJson = (raw) => {
  const chunks = [];
  visitCanonicalJson(raw, (chunk) => chunks.push(chunk));
  return chunks.join('');
};

export const hashCanonicalJson = (raw) => {
  const hash = createHash('sha256');
  visitCanonicalJson(raw, (chunk) => hash.update(chunk));
  return hash.digest('hex');
};

const validDateParts = (match) => {
  const [, year, month, day, hour = '0', minute = '0', second = '0', , offsetHour = '0', offsetMinute = '0'] = match;
  const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1
    && Number(day) <= monthDays[Number(month) - 1] && Number(hour) <= 23
    && Number(minute) <= 59 && Number(second) <= 59 && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59;
};

/** Preserve the original timestamp; never infer a missing date from other fields. */
export const normalizeTimestamp = (value) => {
  const result = { raw: value === undefined ? null : value, utc: null, state: 'missing' };
  if (value === undefined) return result;
  if (value === null) {
    result.state = 'null';
    return result;
  }
  result.state = 'invalid';
  let milliseconds;
  if (typeof value === 'number' && Number.isFinite(value)) {
    milliseconds = value * 1000;
  } else if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) {
      const local = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(value);
      if (local && validDateParts(local)) {
        result.state = 'ambiguous';
      }
      return result;
    }
    if (!validDateParts(match)) return result;
    milliseconds = Date.parse(value);
  } else {
    return result;
  }
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8640000000000000) return result;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return result;
  result.utc = date.toISOString();
  result.state = 'valid';
  return result;
};

const contentType = (value) => {
  if (!isRecord(value)) return 'unknown';
  if (typeof ownValue(value, 'content_type') === 'string') return value.content_type;
  return typeof ownValue(value, 'type') === 'string' ? value.type : 'unknown';
};

const collectAssets = (content) => {
  const assets = [];
  const stack = [content];
  while (stack.length) {
    const value = stack.pop();
    if (isAssetPointer(value)) {
      assets.push({ type: 'asset_pointer', pointer: value, state: 'unresolved', raw: value });
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
      continue;
    }
    const keys = Object.keys(value);
    const pointerKeys = new Set();
    for (const key of keys) {
      const pointer = value[key];
      if (['asset_pointer', 'audio_asset_pointer', 'file_id'].includes(key) && isId(pointer)) {
        assets.push({ type: contentType(value), pointer, state: 'unresolved', raw: value });
        pointerKeys.add(key);
      } else if (key === 'image_url') {
        const url = typeof pointer === 'string' ? pointer : ownValue(pointer, 'url');
        if (isId(url)) {
          assets.push({ type: 'image_url', pointer: url, state: 'unresolved', raw: value });
          pointerKeys.add(key);
        }
      }
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (!pointerKeys.has(keys[index])) stack.push(value[keys[index]]);
    }
  }
  return assets;
};

const normalizeContent = (content, maxTextChars, diagnose) => {
  const parts = [];
  const textChunks = [];
  let remaining = maxTextChars;
  let truncated = false;
  const addText = (value, type, raw) => {
    const separator = textChunks.length && value.length ? '\n' : '';
    const available = Math.max(0, remaining - separator.length);
    let text = value.slice(0, available);
    // Keep a UTF-16 limit from leaving a dangling high surrogate in query text.
    if (text.length < value.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    if (text.length < value.length) truncated = true;
    if (text.length) {
      textChunks.push(`${separator}${text}`);
      remaining -= separator.length + text.length;
    }
    parts.push({ type, text: value, raw });
  };
  const addPart = (part) => {
    if (typeof part === 'string' && !isAssetPointer(part)) {
      addText(part, 'text', part);
      return;
    }
    const type = contentType(part);
    const knownText = ['text', 'input_text', 'output_text', 'audio_transcription', 'code'].includes(type);
    if (knownText && typeof ownValue(part, 'text') === 'string') {
      addText(part.text, type === 'code' ? 'code' : 'text', part);
    } else if (type === 'code' && typeof ownValue(part, 'code') === 'string') {
      addText(part.code, 'code', part);
    } else {
      parts.push({ type, raw: part });
    }
  };
  if (typeof content === 'string') {
    addPart(content);
  } else if (isRecord(content)) {
    if (Array.isArray(ownValue(content, 'parts'))) {
      for (const part of content.parts) addPart(part);
    } else if (hasOwn(content, 'parts')) {
      parts.push({ type: 'unknown', raw: content.parts });
      diagnose('invalid_content_parts');
    }
    if (typeof ownValue(content, 'text') === 'string') addText(content.text, contentType(content) === 'code' ? 'code' : 'text', content);
    if (typeof ownValue(content, 'code') === 'string') addText(content.code, 'code', content);
    if (!hasOwn(content, 'parts') && typeof ownValue(content, 'text') !== 'string' && typeof ownValue(content, 'code') !== 'string') {
      parts.push({ type: contentType(content), raw: content });
    }
  } else if (content !== undefined && content !== null) {
    parts.push({ type: 'unknown', raw: content });
  }
  if (truncated) diagnose('text_truncated');
  return { text: textChunks.join(''), parts, assets: collectAssets(content) };
};

const diagnoseParentCycles = (nodes, byId, diagnose) => {
  const done = new Set();
  for (const node of nodes) {
    if (done.has(node.nodeId)) continue;
    const path = [];
    const positions = new Map();
    let cursor = node.nodeId;
    while (cursor !== null && byId.has(cursor) && !done.has(cursor)) {
      if (positions.has(cursor)) {
        for (let index = positions.get(cursor); index < path.length; index += 1) {
          diagnose('parent_cycle', path[index]);
        }
        break;
      }
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = byId.get(cursor).parentId;
    }
    for (const id of path) done.add(id);
  }
};

const diagnoseChildCycles = (nodes, byId, diagnose) => {
  const states = new Map();
  for (const node of nodes) {
    if (states.has(node.nodeId)) continue;
    const stack = [{ node, index: 0 }];
    states.set(node.nodeId, 'active');
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.node.children.length) {
        states.set(frame.node.nodeId, 'done');
        stack.pop();
        continue;
      }
      const id = frame.node.children[frame.index++];
      if (!byId.has(id)) continue;
      if (states.get(id) === 'active') diagnose('child_cycle', frame.node.nodeId);
      if (states.has(id)) continue;
      states.set(id, 'active');
      stack.push({ node: byId.get(id), index: 0 });
    }
  }
};

/** Normalize one ChatGPT archive conversation while retaining its entire raw evidence. */
export const normalizeConversation = (raw, options = {}) => {
  if (!isRecord(options)) throw invalidInput();
  const { maxNodes = 10000, maxTextChars = 32768 } = options;
  if (!isRecord(raw) || !Number.isSafeInteger(maxNodes) || maxNodes < 1
    || !Number.isSafeInteger(maxTextChars) || maxTextChars < 0) throw invalidInput();
  // Validate all source data before reading fields, so accessors cannot run here.
  const snapshotHash = hashCanonicalJson(raw);
  const ids = ['conversation_id', 'id'].filter((key) => hasOwn(raw, key)).map((key) => raw[key]);
  if (!ids.length || ids.some((id) => !isId(id)) || ids.some((id) => id !== ids[0])) throw invalidInput();
  if (!isRecord(ownValue(raw, 'mapping'))) throw invalidInput();
  const entries = Object.entries(raw.mapping);
  if (entries.length > maxNodes) throw invalidInput();
  const diagnostics = [];
  const seenDiagnostics = new Set();
  const diagnose = (code, nodeId) => {
    const key = JSON.stringify([code, nodeId ?? null]);
    if (seenDiagnostics.has(key)) return;
    seenDiagnostics.add(key);
    diagnostics.push(nodeId === undefined ? { code } : { code, nodeId });
  };
  const byId = new Map();
  const messageIds = new Set();
  const invalidParents = new Set();
  const childSets = new Map();
  const parentOnlyChildren = new Set();
  const nodes = entries.map(([nodeId, source]) => {
    if (!isId(nodeId) || !isRecord(source)
      || (hasOwn(source, 'id') && source.id !== nodeId)) throw invalidInput();
    const message = ownValue(source, 'message');
    if (message !== undefined && message !== null && !isRecord(message)) throw invalidInput();
    if (message && (!isId(ownValue(message, 'id')) || messageIds.has(message.id))) throw invalidInput();
    if (message) messageIds.add(message.id);
    if (!hasOwn(source, 'message')) diagnose('missing_message', nodeId);
    let parentId = ownValue(source, 'parent');
    if (parentId !== null && !isId(parentId)) {
      diagnose(hasOwn(source, 'parent') ? 'invalid_parent' : 'missing_parent', nodeId);
      invalidParents.add(nodeId);
      parentId = null;
    }
    const children = [];
    if (!hasOwn(source, 'children')) {
      parentOnlyChildren.add(nodeId);
    } else if (!Array.isArray(source.children)) {
      diagnose('invalid_children', nodeId);
    } else {
      for (const child of source.children) {
        if (isId(child)) children.push(child);
        else diagnose('invalid_child_reference', nodeId);
      }
    }
    const childSet = new Set(children);
    if (childSet.size < children.length) diagnose('duplicate_child_reference', nodeId);
    childSets.set(nodeId, childSet);
    const author = ownValue(message, 'author');
    const role = typeof ownValue(author, 'role') === 'string' ? author.role : null;
    if (message && role === null) diagnose('missing_role', nodeId);
    const node = {
      nodeId,
      messageId: message?.id ?? null,
      parentId,
      children,
      role,
      pathState: 'unknown',
      ...normalizeContent(ownValue(message, 'content'), maxTextChars, (code) => diagnose(code, nodeId)),
      createdAt: normalizeTimestamp(ownValue(message, 'create_time'))
    };
    if (node.createdAt.state === 'invalid') diagnose('invalid_created_at', nodeId);
    if (node.createdAt.state === 'ambiguous') diagnose('ambiguous_created_at', nodeId);
    byId.set(nodeId, node);
    return node;
  });
  // A missing children field is a valid parent-only export representation.
  // Explicit child arrays remain authoritative and retain mismatch diagnostics.
  for (const node of nodes) {
    if (node.parentId !== null && parentOnlyChildren.has(node.parentId)) {
      byId.get(node.parentId).children.push(node.nodeId);
      childSets.get(node.parentId).add(node.nodeId);
    }
  }
  for (const node of nodes) {
    if (parentOnlyChildren.has(node.nodeId)) node.children.sort();
  }
  for (const node of nodes) {
    if (node.parentId !== null) {
      if (!byId.has(node.parentId)) diagnose('dangling_parent', node.nodeId);
      else if (!childSets.get(node.parentId).has(node.nodeId)) diagnose('parent_child_mismatch', node.nodeId);
    }
    for (const child of node.children) {
      if (!byId.has(child)) diagnose('dangling_child', node.nodeId);
      else if (byId.get(child).parentId !== node.nodeId) diagnose('child_parent_mismatch', node.nodeId);
    }
  }
  diagnoseParentCycles(nodes, byId, diagnose);
  diagnoseChildCycles(nodes, byId, diagnose);
  const current = ownValue(raw, 'current_node');
  const currentNode = isId(current) ? current : null;
  if (currentNode === null) {
    diagnose(current === undefined || current === null ? 'missing_current_node' : 'invalid_current_node');
  } else if (!byId.has(currentNode)) {
    diagnose('dangling_current_node');
  } else {
    const selected = new Set();
    let cursor = currentNode;
    let complete = true;
    while (cursor !== null) {
      if (!byId.has(cursor) || selected.has(cursor) || invalidParents.has(cursor)) {
        complete = false;
        break;
      }
      selected.add(cursor);
      cursor = byId.get(cursor).parentId;
    }
    if (complete) {
      for (const node of nodes) {
        node.pathState = selected.has(node.nodeId) ? 'on_selected_path' : 'off_selected_path';
      }
    } else {
      diagnose('incomplete_selected_path');
    }
  }
  return { conversationId: ids[0], snapshotHash, currentNode, diagnostics, nodes, raw };
};
