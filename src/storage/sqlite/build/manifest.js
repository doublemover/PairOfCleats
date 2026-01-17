import { normalizeFilePath } from '../utils.js';

export function getFileManifest(db, mode) {
  const rows = db.prepare('SELECT file, hash, mtimeMs, size FROM file_manifest WHERE mode = ?')
    .all(mode);
  const map = new Map();
  for (const row of rows) {
    map.set(normalizeFilePath(row.file), row);
  }
  return map;
}

export function isManifestMatch(entry, dbEntry, options = {}) {
  if (!dbEntry) return false;
  const strictHash = options.strictHash === true;
  if (entry?.hash && dbEntry.hash) return entry.hash === dbEntry.hash;
  if (strictHash && entry?.hash && !dbEntry.hash) return false;
  const mtimeMatch = Number.isFinite(entry?.mtimeMs) && Number.isFinite(dbEntry?.mtimeMs)
    ? entry.mtimeMs === dbEntry.mtimeMs
    : false;
  const sizeMatch = Number.isFinite(entry?.size) && Number.isFinite(dbEntry?.size)
    ? entry.size === dbEntry.size
    : false;
  return mtimeMatch && sizeMatch;
}

export function normalizeManifestFiles(manifestFiles) {
  const entries = [];
  const map = new Map();
  const conflicts = [];
  for (const [file, entry] of Object.entries(manifestFiles || {})) {
    const normalized = normalizeFilePath(file);
    const record = { file, normalized, entry };
    const existing = map.get(normalized);
    if (!existing) {
      map.set(normalized, record);
      continue;
    }
    if (isManifestMatch(entry, existing.entry)) {
      if (!existing.entry?.hash && entry?.hash) {
        map.set(normalized, record);
      }
      continue;
    }
    const score = (candidate) => (candidate?.hash ? 3 : 0)
      + (Number.isFinite(candidate?.mtimeMs) ? 1 : 0)
      + (Number.isFinite(candidate?.size) ? 1 : 0);
    if (score(entry) > score(existing.entry)) {
      map.set(normalized, record);
    }
    conflicts.push(normalized);
  }
  entries.push(...map.values());
  return { entries, map, conflicts };
}

export function diffFileManifests(manifestEntries, dbFiles) {
  const changed = [];
  const deleted = [];
  const manifestSet = new Set();

  for (const record of manifestEntries || []) {
    if (!record?.normalized) continue;
    manifestSet.add(record.normalized);
    const dbEntry = dbFiles.get(record.normalized);
    if (!isManifestMatch(record.entry, dbEntry, { strictHash: true })) {
      changed.push(record);
    }
  }

  for (const [file] of dbFiles.entries()) {
    if (!manifestSet.has(file)) deleted.push(file);
  }

  return { changed, deleted };
}
