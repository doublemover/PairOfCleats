import path from 'node:path';
import { readJsonFile } from '../../../shared/artifact-io.js';

export const STAGE_ORDER = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
  stage4: 4
};

export const normalizeStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
  if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

export const readJsonOptional = (dir, name) => {
  const filePath = path.join(dir, name);
  try {
    return readJsonFile(filePath);
  } catch (err) {
    if (err?.code === 'ERR_JSON_TOO_LARGE') throw err;
    return null;
  }
};

export const readArray = (value, key) => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value[key])) return value[key];
  if (value.arrays && Array.isArray(value.arrays[key])) return value.arrays[key];
  return [];
};

export const readField = (value, key) => {
  if (!value || typeof value !== 'object') return null;
  if (value.fields && Object.prototype.hasOwnProperty.call(value.fields, key)) {
    return value.fields[key];
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  return null;
};

export const mergeTfPostings = (map, token, postings, docOffset) => {
  if (!Array.isArray(postings)) return;
  let dest = map.get(token);
  if (!dest) {
    if (docOffset) {
      for (const entry of postings) {
        if (!Array.isArray(entry)) continue;
        const docId = entry[0];
        if (!Number.isFinite(docId)) continue;
        entry[0] = docId + docOffset;
      }
    }
    map.set(token, postings);
    return;
  }
  for (const entry of postings) {
    if (!Array.isArray(entry)) continue;
    const docId = entry[0];
    if (!Number.isFinite(docId)) continue;
    if (docOffset) {
      entry[0] = docId + docOffset;
    }
    dest.push(entry);
  }
};

export const mergeIdPostings = (map, token, postings, docOffset) => {
  if (!Array.isArray(postings)) return;
  let dest = map.get(token);
  if (!dest) {
    if (docOffset) {
      for (let i = 0; i < postings.length; i += 1) {
        const docId = postings[i];
        if (!Number.isFinite(docId)) continue;
        postings[i] = docId + docOffset;
      }
    }
    map.set(token, postings);
    return;
  }
  if (!docOffset) {
    for (const docId of postings) {
      if (!Number.isFinite(docId)) continue;
      dest.push(docId);
    }
    return;
  }
  for (const docId of postings) {
    if (!Number.isFinite(docId)) continue;
    dest.push(docId + docOffset);
  }
};

export const computeBm25 = (docLengths) => {
  if (!Array.isArray(docLengths) || docLengths.length === 0) {
    return { avgChunkLen: 0, k1: 1.2, b: 0.75 };
  }
  const total = docLengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0);
  const avgChunkLen = total / docLengths.length;
  const b = avgChunkLen > 800 ? 0.6 : 0.8;
  const k1 = avgChunkLen > 800 ? 1.2 : 1.7;
  return { avgChunkLen, k1, b };
};

export const validateLengths = (label, list, expected, dir, { allowMissing = false } = {}) => {
  const location = dir ? ` in ${dir}` : '';
  if (!Array.isArray(list)) {
    if (!allowMissing && expected > 0) {
      throw new Error(`${label} missing (${expected} expected)${location}`);
    }
    return;
  }
  if (expected > 0 && list.length === 0) {
    throw new Error(`${label} empty (${expected} expected)${location}`);
  }
  if (list.length !== expected) {
    throw new Error(`${label} length mismatch (${list.length} !== ${expected})${location}`);
  }
};

export const normalizeIdList = (list) => {
  if (!Array.isArray(list)) return [];
  const filtered = new Array(list.length);
  let count = 0;
  for (let i = 0; i < list.length; i += 1) {
    const value = list[i];
    if (!Number.isFinite(value)) continue;
    filtered[count] = value;
    count += 1;
  }
  if (count <= 1) {
    return count === 1 ? [filtered[0]] : [];
  }
  filtered.length = count;
  filtered.sort((a, b) => a - b);
  let write = 1;
  for (let read = 1; read < filtered.length; read += 1) {
    if (filtered[read] !== filtered[write - 1]) {
      filtered[write] = filtered[read];
      write += 1;
    }
  }
  filtered.length = write;
  return filtered;
};

export const normalizeTfPostings = (list) => {
  if (!Array.isArray(list)) return [];
  if (list.length <= 1) return list;
  const filtered = list.reduce((acc, entry) => {
    if (!Array.isArray(entry)) return acc;
    const docId = entry[0];
    const count = entry[1];
    if (!Number.isFinite(docId) || !Number.isFinite(count)) return acc;
    acc.push([docId, Math.trunc(count)]);
    return acc;
  }, []);
  filtered.sort((a, b) => {
    const delta = a[0] - b[0];
    return delta || (a[1] - b[1]);
  });
  return filtered;
};

export const buildChunkOrdering = (chunks) => {
  const entries = chunks.map((chunk, index) => {
    const startRaw = Number(chunk?.start);
    const endRaw = Number(chunk?.end);
    return {
      chunk,
      oldId: index,
      file: typeof chunk?.file === 'string' ? chunk.file : '',
      start: Number.isFinite(startRaw) ? startRaw : 0,
      end: Number.isFinite(endRaw) ? endRaw : 0
    };
  });
  entries.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.oldId - b.oldId;
  });
  return entries;
};

export const remapTfPostings = (map, docMap) => {
  for (const [token, list] of map.entries()) {
    if (!Array.isArray(list)) continue;
    const remapped = list.map((entry) => {
      if (!Array.isArray(entry)) return entry;
      const docId = entry[0];
      const nextId = Number.isFinite(docId) ? docMap[docId] : null;
      if (!Number.isFinite(nextId)) return entry;
      const nextEntry = entry.slice();
      nextEntry[0] = nextId;
      return nextEntry;
    });
    map.set(token, remapped);
  }
};

export const remapIdPostings = (map, docMap) => {
  for (const [token, list] of map.entries()) {
    if (!Array.isArray(list)) continue;
    const remapped = list
      .map((docId) => (Number.isFinite(docId) ? docMap[docId] : null))
      .filter((docId) => Number.isFinite(docId));
    map.set(token, remapped);
  }
};
