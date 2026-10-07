import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { fileExt } from '../../../shared/file-paths.js';

const REQUIRED_FILE_META_COLUMNS = new Set(['id', 'file', 'ext']);
const ARRAY_MAP = Array.prototype.map;

const shouldKeepFileMetaColumn = (column, values) => {
  if (REQUIRED_FILE_META_COLUMNS.has(column)) return true;
  return Array.isArray(values) && values.some((value) => value !== null && value !== undefined);
};

const isFingerprintPrimitive = (value) => value == null
  || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

export const computeFileMetaFingerprint = ({ files, fileInfoByPath }) => {
  const list = files.map((file) => {
    const info = fileInfoByPath?.get?.(file) || null;
    return {
      file,
      size: Number.isFinite(info?.size) ? info.size : null,
      hash: info?.hash || null,
      hashAlgo: info?.hashAlgo || null
    };
  });
  // Finish all source reads before serialization, as in the materialized route.
  // Complex values can observe canonicalization/toJSON ordering across rows.
  const canStream = Array.isArray(files)
    && !types.isProxy(files)
    && Object.getPrototypeOf(files) === Array.prototype
    && !Object.hasOwn(files, 'map') && !Object.hasOwn(files, 'constructor')
    && Object.getOwnPropertyDescriptor(Array.prototype, 'map')?.value === ARRAY_MAP
    && Object.getPrototypeOf(list) === Array.prototype
    && !('toJSON' in list)
    && list.every((row) => row && isFingerprintPrimitive(row.file)
      && isFingerprintPrimitive(row.size) && isFingerprintPrimitive(row.hash)
      && isFingerprintPrimitive(row.hashAlgo));
  if (!canStream) return sha1(stableStringifyForSignature(list));

  const digest = createHash('sha1');
  digest.update('[');
  for (let i = 0; i < list.length; i += 1) {
    if (i) digest.update(',');
    // Array holes are JSON nulls. Each ordinary row has the same canonical
    // bytes as it did inside the old whole-array canonicalization.
    digest.update(list[i] ? stableStringifyForSignature(list[i]) : 'null');
  }
  digest.update(']');
  return digest.digest('hex');
};

export const buildFileMetaColumnar = (fileMeta) => {
  const rows = Array.isArray(fileMeta) ? fileMeta : [];
  const fileTable = [];
  const fileIndex = new Map();
  const extTable = [];
  const extIndex = new Map();
  const pushTable = (value, table, index) => {
    if (!value) return null;
    if (index.has(value)) return index.get(value);
    const id = table.length;
    table.push(value);
    index.set(value, id);
    return id;
  };
  const arrays = {
    id: [],
    file: [],
    ext: [],
    size: null,
    hash: null,
    hashAlgo: null,
    encoding: null,
    encodingFallback: null,
    encodingFallbackClass: null,
    encodingFallbackRisk: null,
    encodingConfidence: null,
    externalDocs: null,
    last_modified: null,
    last_author: null,
    churn: null,
    churn_added: null,
    churn_deleted: null,
    churn_commits: null
  };
  let rowIndex = 0;
  const pushOptionalColumn = (column, value) => {
    let values = arrays[column];
    if (!values && value !== null) {
      values = new Array(rowIndex).fill(null);
      arrays[column] = values;
    }
    if (values) values.push(value);
  };
  for (const row of rows) {
    arrays.id.push(row?.id ?? null);
    arrays.file.push(pushTable(row?.file || null, fileTable, fileIndex));
    arrays.ext.push(pushTable(row?.ext || null, extTable, extIndex));
    pushOptionalColumn('size', row?.size ?? null);
    pushOptionalColumn('hash', row?.hash ?? null);
    pushOptionalColumn('hashAlgo', row?.hashAlgo ?? null);
    pushOptionalColumn('encoding', row?.encoding ?? null);
    pushOptionalColumn('encodingFallback', typeof row?.encodingFallback === 'boolean' ? row.encodingFallback : null);
    pushOptionalColumn('encodingFallbackClass', typeof row?.encodingFallbackClass === 'string' ? row.encodingFallbackClass : null);
    pushOptionalColumn('encodingFallbackRisk', typeof row?.encodingFallbackRisk === 'string' ? row.encodingFallbackRisk : null);
    pushOptionalColumn('encodingConfidence', row?.encodingConfidence ?? null);
    pushOptionalColumn('externalDocs', row?.externalDocs ?? null);
    pushOptionalColumn('last_modified', row?.last_modified ?? null);
    pushOptionalColumn('last_author', row?.last_author ?? null);
    pushOptionalColumn('churn', row?.churn ?? null);
    pushOptionalColumn('churn_added', row?.churn_added ?? null);
    pushOptionalColumn('churn_deleted', row?.churn_deleted ?? null);
    pushOptionalColumn('churn_commits', row?.churn_commits ?? null);
    rowIndex += 1;
  }
  const columns = [];
  const compactArrays = {};
  for (const [column, values] of Object.entries(arrays)) {
    if (!shouldKeepFileMetaColumn(column, values)) continue;
    columns.push(column);
    compactArrays[column] = values;
  }
  return {
    format: 'columnar',
    columns,
    length: rows.length,
    arrays: compactArrays,
    tables: {
      file: fileTable,
      ext: extTable
    }
  };
};

export function buildFileMeta(state) {
  const fileMeta = [];
  const fileIdByPath = new Map();
  const comparePaths = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));
  const fileInfoByPath = state?.fileInfoByPath;
  const fileDetailsByPath = state?.fileDetailsByPath;
  const fileDetails = new Map();
  if (fileDetailsByPath && typeof fileDetailsByPath.entries === 'function') {
    for (const [file, info] of fileDetailsByPath.entries()) {
      fileDetails.set(file, { ...(info || {}), file });
    }
  }
  if (!fileDetails.size) {
    for (const c of state.chunks) {
      if (!c?.file) continue;
      if (!fileDetails.has(c.file)) {
        fileDetails.set(c.file, {
          file: c.file,
          ext: c.ext,
          size: Number.isFinite(c.fileSize) ? c.fileSize : null,
          hash: c.fileHash || null,
          hashAlgo: c.fileHashAlgo || null,
          externalDocs: c.externalDocs,
          last_modified: c.last_modified,
          last_author: c.last_author,
          churn: c.churn,
          churn_added: c.churn_added,
          churn_deleted: c.churn_deleted,
          churn_commits: c.churn_commits
        });
        continue;
      }
      const info = fileDetails.get(c.file);
      if (!info.ext && c.ext) info.ext = c.ext;
      if (!info.size && Number.isFinite(c.fileSize)) info.size = c.fileSize;
      if (!info.hash && c.fileHash) info.hash = c.fileHash;
      if (!info.hashAlgo && c.fileHashAlgo) info.hashAlgo = c.fileHashAlgo;
      if (!info.externalDocs && c.externalDocs) info.externalDocs = c.externalDocs;
      if (!info.last_modified && c.last_modified) info.last_modified = c.last_modified;
      if (!info.last_author && c.last_author) info.last_author = c.last_author;
    }
  }
  const discoveredFiles = Array.isArray(state?.discoveredFiles) ? state.discoveredFiles : null;
  const fileInfoFiles = fileInfoByPath && typeof fileInfoByPath.keys === 'function'
    ? Array.from(fileInfoByPath.keys())
    : [];
  const files = discoveredFiles && discoveredFiles.length
    ? discoveredFiles.slice().sort(comparePaths)
    : Array.from(new Set([
      ...fileDetails.keys(),
      ...fileInfoFiles
    ])).sort(comparePaths);
  for (const file of files) {
    const entry = fileDetails.get(file) || { file, ext: fileExt(file) };
    const info = fileInfoByPath?.get?.(file) || null;
    const id = fileMeta.length;
    fileIdByPath.set(file, id);
    fileMeta.push({
      id,
      file: entry.file,
      ext: entry.ext || fileExt(entry.file),
      size: Number.isFinite(info?.size) ? info.size : entry.size,
      hash: info?.hash || entry.hash || null,
      hashAlgo: info?.hashAlgo || entry.hashAlgo || null,
      encoding: info?.encoding || null,
      encodingFallback: typeof info?.encodingFallback === 'boolean' ? info.encodingFallback : null,
      encodingFallbackClass: typeof info?.encodingFallbackClass === 'string' ? info.encodingFallbackClass : null,
      encodingFallbackRisk: typeof info?.encodingFallbackRisk === 'string' ? info.encodingFallbackRisk : null,
      encodingConfidence: Number.isFinite(info?.encodingConfidence) ? info.encodingConfidence : null,
      externalDocs: entry.externalDocs,
      last_modified: entry.last_modified,
      last_author: entry.last_author,
      churn: entry.churn,
      churn_added: entry.churn_added,
      churn_deleted: entry.churn_deleted,
      churn_commits: entry.churn_commits
    });
  }
  const fingerprint = computeFileMetaFingerprint({ files, fileInfoByPath });
  return { fileMeta, fileIdByPath, fingerprint };
}
