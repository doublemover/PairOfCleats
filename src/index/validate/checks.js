import { buildMetaV2 } from '../metadata-v2.js';
import { stableStringify } from '../../shared/stable-json.js';
import { addIssue } from './issues.js';

export const validatePostingsDocIds = (report, mode, label, postings, chunkCount) => {
  const maxErrors = 20;
  let errors = 0;
  for (const posting of postings || []) {
    if (!Array.isArray(posting)) continue;
    for (const entry of posting) {
      const docId = Array.isArray(entry) ? entry[0] : null;
      if (!Number.isFinite(docId) || docId < 0 || docId >= chunkCount) {
        if (errors < maxErrors) {
          addIssue(report, mode, `${label} docId out of range (${docId})`, 'Rebuild index artifacts for this mode.');
        }
        errors += 1;
        if (errors >= maxErrors) return;
      }
    }
  }
};

export const validateIdPostings = (report, mode, label, postings, chunkCount) => {
  const maxErrors = 20;
  let errors = 0;
  for (const posting of postings || []) {
    if (!Array.isArray(posting)) continue;
    for (const docId of posting) {
      if (!Number.isFinite(docId) || docId < 0 || docId >= chunkCount) {
        if (errors < maxErrors) {
          addIssue(report, mode, `${label} docId out of range (${docId})`, 'Rebuild index artifacts for this mode.');
        }
        errors += 1;
        if (errors >= maxErrors) return;
      }
    }
  }
};

export const validateChunkIds = (report, mode, chunkMeta) => {
  const seen = new Set();
  for (let i = 0; i < chunkMeta.length; i += 1) {
    const entry = chunkMeta[i];
    const id = Number.isFinite(entry?.id) ? entry.id : null;
    if (id === null) {
      addIssue(report, mode, `chunk_meta missing id at index ${i}`, 'Rebuild index artifacts for this mode.');
      return;
    }
    if (seen.has(id)) {
      addIssue(report, mode, `chunk_meta duplicate id ${id}`, 'Rebuild index artifacts for this mode.');
      return;
    }
    seen.add(id);
    if (id !== i) {
      addIssue(report, mode, `chunk_meta id mismatch at index ${i} (id=${id})`, 'Rebuild index artifacts for this mode.');
      return;
    }
  }
};

export const validateChunkIdentity = (report, mode, chunkMeta) => {
  const maxErrors = 20;
  let errors = 0;
  const seenUids = new Set();
  for (const entry of Array.isArray(chunkMeta) ? chunkMeta : []) {
    if (errors >= maxErrors) return;
    if (!entry) continue;
    const meta = entry.metaV2 || {};
    const chunkUid = meta.chunkUid || entry.chunkUid;
    const virtualPath = meta.virtualPath || entry.virtualPath || meta.segment?.virtualPath || entry.segment?.virtualPath;
    if (!chunkUid) {
      addIssue(report, mode, 'chunk_meta missing chunkUid', 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    if (!virtualPath) {
      addIssue(report, mode, `chunk_meta missing virtualPath (chunkUid=${chunkUid})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    const segment = meta.segment || entry.segment || null;
    if (segment && !segment.segmentUid) {
      addIssue(report, mode, `chunk_meta missing segmentUid (chunkUid=${chunkUid})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    if (seenUids.has(chunkUid)) {
      addIssue(report, mode, `chunk_meta duplicate chunkUid (${chunkUid})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    seenUids.add(chunkUid);
  }
};

export const validateFileNameCollisions = (report, mode, repoMap) => {
  const seen = new Set();
  for (const entry of Array.isArray(repoMap) ? repoMap : []) {
    const file = entry?.file;
    const name = entry?.name;
    if (!file || !name) continue;
    const kind = typeof entry?.kind === 'string' ? entry.kind : '';
    const signature = typeof entry?.signature === 'string' ? entry.signature : '';
    const lineMarker = Number.isFinite(entry?.startLine)
      ? entry.startLine
      : (Number.isFinite(entry?.start) ? entry.start : '');
    const key = `${file}::${name}::${kind}::${signature}::${lineMarker}`;
    if (seen.has(key)) {
      addIssue(
        report,
        mode,
        `ERR_ID_COLLISION duplicate file::name identifier: ${file}::${name}`,
        'Resolve symbol name collisions or update artifact generation.'
      );
      return;
    }
    seen.add(key);
  }
};

const validateTypeEntryList = (report, mode, chunkId, label, entries) => {
  if (!Array.isArray(entries)) {
    addIssue(report, mode, `metaV2.types invalid ${label} (chunkId=${chunkId})`, 'Rebuild index artifacts for this mode.');
    return false;
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.type) {
      addIssue(report, mode, `metaV2.types missing type in ${label} (chunkId=${chunkId})`, 'Rebuild index artifacts for this mode.');
      return false;
    }
  }
  return true;
};

export const validateMetaV2Types = (report, mode, chunkMeta) => {
  const maxErrors = 20;
  let errors = 0;
  for (const entry of Array.isArray(chunkMeta) ? chunkMeta : []) {
    if (errors >= maxErrors) return;
    const meta = entry?.metaV2;
    if (!meta || typeof meta !== 'object') continue;
    const types = meta.types;
    if (!types || typeof types !== 'object') continue;
    const chunkId = meta.chunkId || entry?.chunkId || entry?.id || 'unknown';
    for (const [bucketKey, bucket] of Object.entries(types)) {
      if (!bucket || typeof bucket !== 'object') continue;
      for (const [key, value] of Object.entries(bucket)) {
        if (errors >= maxErrors) return;
        if (key === 'params') {
          if (value == null) continue;
          if (Array.isArray(value) || typeof value !== 'object') {
            addIssue(
              report,
              mode,
              `metaV2.types.${bucketKey}.params must be map (chunkId=${chunkId})`,
              'Rebuild index artifacts for this mode.'
            );
            errors += 1;
            if (errors >= maxErrors) return;
            continue;
          }
          for (const [paramName, list] of Object.entries(value)) {
            if (!validateTypeEntryList(report, mode, chunkId, `${bucketKey}.params.${paramName}`, list)) {
              errors += 1;
              if (errors >= maxErrors) return;
            }
          }
          continue;
        }
        if (Array.isArray(value)) {
          if (!validateTypeEntryList(report, mode, chunkId, `${bucketKey}.${key}`, value)) {
            errors += 1;
            if (errors >= maxErrors) return;
          }
          continue;
        }
        if (value && typeof value === 'object') {
          for (const [innerKey, list] of Object.entries(value)) {
            if (!validateTypeEntryList(report, mode, chunkId, `${bucketKey}.${key}.${innerKey}`, list)) {
              errors += 1;
              if (errors >= maxErrors) return;
            }
          }
        }
      }
    }
  }
};

export const validateSqliteMetaV2Parity = (report, mode, chunkMeta, sqliteRows, options = {}) => {
  const maxErrors = Number.isFinite(options.maxErrors) ? options.maxErrors : 20;
  const pickMeta = (meta) => ({
    chunkId: meta?.chunkId ?? null,
    file: meta?.file ?? null,
    range: meta?.range ?? null,
    lang: meta?.lang ?? null,
    ext: meta?.ext ?? null,
    types: meta?.types ?? null,
    relations: meta?.relations ?? null,
    segment: meta?.segment ?? null
  });
  let errors = 0;
  for (const row of Array.isArray(sqliteRows) ? sqliteRows : []) {
    if (errors >= maxErrors) return;
    const id = Number.isFinite(row?.id) ? row.id : null;
    if (id == null) continue;
    const jsonEntry = chunkMeta?.[id];
    if (!jsonEntry) {
      addIssue(report, mode, `sqlite chunk ${id} missing from JSONL chunk_meta`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    if (row.metaV2_json == null || row.metaV2_json === '') {
      addIssue(report, mode, `sqlite metaV2_json missing (chunkId=${row.chunk_id ?? id})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    let sqliteMeta = null;
    if (typeof row.metaV2_json === 'string') {
      try {
        sqliteMeta = JSON.parse(row.metaV2_json);
      } catch {
        addIssue(report, mode, `sqlite metaV2_json invalid (chunkId=${row.chunk_id ?? id})`, 'Rebuild index artifacts for this mode.');
        errors += 1;
        continue;
      }
    } else {
      sqliteMeta = row.metaV2_json;
    }
    if (sqliteMeta?.chunkId && row.chunk_id && sqliteMeta.chunkId !== row.chunk_id) {
      addIssue(report, mode, `sqlite metaV2.chunkId mismatch (row=${row.chunk_id}, meta=${sqliteMeta.chunkId})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
      continue;
    }
    const expected = pickMeta(jsonEntry.metaV2);
    const actual = pickMeta(sqliteMeta);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      addIssue(report, mode, `sqlite metaV2 mismatch for chunk ${id}`, 'Rebuild index artifacts for this mode.');
      errors += 1;
    }
  }
};

export const validateMetaV2Equivalence = (report, mode, chunkMeta, options = {}) => {
  const maxErrors = Number.isFinite(options.maxErrors) ? options.maxErrors : 10;
  const maxSamples = Number.isFinite(options.maxSamples) ? options.maxSamples : 25;
  let errors = 0;
  let sampled = 0;
  for (const entry of Array.isArray(chunkMeta) ? chunkMeta : []) {
    if (errors >= maxErrors || sampled >= maxSamples) return;
    if (!entry?.metaV2 || typeof entry.metaV2 !== 'object') continue;
    if (entry.docmeta == null) continue;
    const toolInfo = entry.metaV2.tooling && typeof entry.metaV2.tooling === 'object'
      ? {
        tool: entry.metaV2.tooling.tool || 'pairofcleats',
        version: entry.metaV2.tooling.version || null,
        configHash: entry.metaV2.tooling.configHash || null
      }
      : null;
    const meta = entry.metaV2;
    let identity = entry.identity || null;
    if (!identity) {
      const hasIdentity = meta.chunkUidAlgoVersion || meta.spanHash || meta.preHash || meta.postHash || meta.collisionOf;
      identity = hasIdentity
        ? {
          chunkUidAlgoVersion: meta.chunkUidAlgoVersion ?? null,
          spanHash: meta.spanHash ?? null,
          preHash: meta.preHash ?? null,
          postHash: meta.postHash ?? null,
          collisionOf: meta.collisionOf ?? null
        }
        : null;
    }
    const chunkForMeta = {
      ...entry,
      identity,
      chunkUid: entry.chunkUid || meta.chunkUid || null,
      virtualPath: entry.virtualPath || meta.virtualPath || entry.segment?.virtualPath || null,
      segment: entry.segment || meta.segment || null,
      file: entry.file || meta.file || null,
      ext: entry.ext || meta.ext || null,
      lang: entry.lang || meta.lang || null,
      containerLanguageId: entry.containerLanguageId || meta.container?.languageId || null
    };
    const recomputed = buildMetaV2({
      chunk: chunkForMeta,
      docmeta: entry.docmeta,
      toolInfo,
      analysisPolicy: { metadata: { enabled: true } }
    });
    const expected = stableStringify(entry.metaV2);
    const actual = stableStringify(recomputed);
    sampled += 1;
    if (expected !== actual) {
      const chunkId = entry.metaV2.chunkId || entry.chunkId || entry.id || 'unknown';
      addIssue(report, mode, `metaV2 finalize mismatch (chunkId=${chunkId})`, 'Rebuild index artifacts for this mode.');
      errors += 1;
    }
  }
};
