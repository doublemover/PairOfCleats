import { normalizeFilePath } from '../utils.js';
import { toArray } from '../../../shared/iterables.js';
import { resolveManifestBundleNames } from '../../../shared/bundle-io.js';

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
  const conflicts = new Set();
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
    conflicts.add(normalized);
  }
  entries.push(...map.values());
  return { entries, map, conflicts: Array.from(conflicts) };
}

export function diffFileManifests(manifestEntries, dbFiles) {
  const changed = [];
  const deleted = [];
  const manifestUpdates = [];
  const manifestSet = new Set();

  for (const record of toArray(manifestEntries)) {
    if (!record?.normalized) continue;
    manifestSet.add(record.normalized);
    const dbEntry = dbFiles.get(record.normalized);
    if (isManifestMatch(record.entry, dbEntry, { strictHash: true })) continue;
    if (record.entry?.hash && !dbEntry?.hash) {
      if (isManifestMatch(record.entry, dbEntry, { strictHash: false })) {
        manifestUpdates.push(record);
        continue;
      }
    }
    changed.push(record);
  }

  for (const [file] of dbFiles.entries()) {
    if (!manifestSet.has(file)) deleted.push(file);
  }

  return { changed, deleted, manifestUpdates };
}

export function validateIncrementalManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: ['manifest missing or invalid'] };
  }
  const files = manifest.files;
  if (!files || typeof files !== 'object') {
    return { ok: false, errors: ['manifest.files missing or invalid'] };
  }
  const entries = Object.entries(files);
  if (!entries.length) {
    return { ok: false, errors: ['manifest.files empty'] };
  }
  const maxErrors = 5;
  for (const [file, entry] of entries) {
    if (errors.length >= maxErrors) break;
    if (typeof file !== 'string' || !file.trim()) {
      errors.push('manifest file key missing or invalid');
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      errors.push(`manifest entry invalid for ${file}`);
      continue;
    }
    const hasHash = entry.hash != null;
    const hasMtime = entry.mtimeMs != null;
    const hasSize = entry.size != null;
    if (!hasHash && !hasMtime && !hasSize) {
      errors.push(`manifest entry missing metadata for ${file}`);
      continue;
    }
    if (hasHash && typeof entry.hash !== 'string') {
      errors.push(`manifest entry hash invalid for ${file}`);
    }
    if (hasMtime && !Number.isFinite(entry.mtimeMs)) {
      errors.push(`manifest entry mtimeMs invalid for ${file}`);
    }
    if (hasSize && !Number.isFinite(entry.size)) {
      errors.push(`manifest entry size invalid for ${file}`);
    }
    if (!resolveManifestBundleNames(entry).length) {
      errors.push(`manifest entry bundles invalid for ${file}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
