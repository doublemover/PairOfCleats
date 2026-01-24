import fs from 'node:fs';
import { loadGraphRelationsSync, loadJsonArrayArtifactSync, readJsonFile } from '../../shared/artifact-io.js';

export const readJsonOptional = (filePath, warnings) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJsonFile(filePath);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read ${filePath}${detail}`);
    return null;
  }
};

export const readJsonArrayOptional = (dir, baseName, warnings) => {
  try {
    return loadJsonArrayArtifactSync(dir, baseName);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read ${baseName}${detail}`);
    return null;
  }
};

export const readGraphRelationsOptional = (dir, warnings) => {
  try {
    return loadGraphRelationsSync(dir);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read graph_relations${detail}`);
    return null;
  }
};

export const hydrateChunkMeta = (chunks, fileMetaRaw) => {
  if (!Array.isArray(chunks)) return [];
  if (!Array.isArray(fileMetaRaw)) return chunks;
  const fileMetaById = new Map();
  for (const entry of fileMetaRaw) {
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  for (const chunk of chunks) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
  }
  return chunks;
};
