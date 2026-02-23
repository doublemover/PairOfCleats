import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACT_SCHEMA_DEFS,
  MANIFEST_ONLY_ARTIFACT_NAMES,
  validateArtifact
} from '../../shared/artifact-schemas.js';
import { fromPosix, isPathWithinRoot } from '../../shared/files.js';
import { addIssue } from './issues.js';
import { isManifestPathSafe, normalizeManifestPath } from './paths.js';

export const validateManifestEntries = (report, mode, dir, manifest, { strictSchema = true } = {}) => {
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  const seenPaths = new Set();
  const root = path.resolve(dir);
  const rootCanonical = toRealPathSync(root);
  for (const entry of pieces) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) {
      addIssue(report, mode, 'manifest entry missing name');
    } else if (strictSchema && !ARTIFACT_SCHEMA_DEFS[name]) {
      if (MANIFEST_ONLY_ARTIFACT_NAMES.includes(name)) {
        continue;
      }
      addIssue(report, mode, `manifest entry uses unknown artifact name: ${name}`);
    }

    const relPath = typeof entry?.path === 'string' ? entry.path : '';
    if (!relPath) {
      addIssue(report, mode, `manifest entry missing path (${name || 'unknown'})`);
      continue;
    }
    if (relPath.includes('\\')) {
      addIssue(report, mode, `manifest path must use '/' separators: ${relPath}`);
    }
    if (!isManifestPathSafe(relPath)) {
      addIssue(report, mode, `manifest path is not safe: ${relPath}`);
      continue;
    }
    const normalized = normalizeManifestPath(relPath);
    if (seenPaths.has(normalized)) {
      addIssue(report, mode, `manifest path duplicated: ${relPath}`);
    } else {
      seenPaths.add(normalized);
    }
    const resolved = path.resolve(dir, fromPosix(normalized));
    if (!isPathWithinRoot(resolved, root)) {
      addIssue(report, mode, `manifest path escapes index root: ${relPath}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      addIssue(report, mode, `manifest path missing: ${relPath}`);
    }
  }
};

export const validateSchema = (report, mode, name, payload, hint, { strictSchema = false } = {}) => {
  if (strictSchema && !ARTIFACT_SCHEMA_DEFS[name]) {
    addIssue(report, mode, `unknown artifact schema: ${name}`, hint);
    return false;
  }
  const result = validateArtifact(name, payload);
  if (!result.ok) {
    const detail = result.errors.length ? ` (${result.errors.join('; ')})` : '';
    addIssue(report, mode, `${name} schema invalid${detail}`, hint);
  }
  return result.ok;
};
