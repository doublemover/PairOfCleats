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
