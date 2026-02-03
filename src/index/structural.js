import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile, readJsonLinesArray } from '../shared/artifact-io.js';
import { isAbsolutePath, toPosix } from '../shared/files.js';

const normalizePath = (repoRoot, rawPath) => {
  if (!rawPath) return null;
  const raw = String(rawPath);
  const resolved = isAbsolutePath(raw) ? raw : path.resolve(repoRoot, raw);
  const rel = path.relative(repoRoot, resolved);
  if (!rel || rel.startsWith('..')) return toPosix(raw);
  return toPosix(rel);
};

const normalizeMatch = (repoRoot, entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const relPath = normalizePath(repoRoot, entry.path || entry.file || entry.uri);
  if (!relPath) return null;
  const startLine = Number.isFinite(Number(entry.startLine)) ? Number(entry.startLine) : null;
  const endLine = Number.isFinite(Number(entry.endLine)) ? Number(entry.endLine) : startLine;
  return {
    engine: entry.engine || null,
    pack: entry.pack || null,
    ruleId: entry.ruleId || null,
    message: entry.message || null,
    severity: entry.severity || null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    path: relPath,
    startLine,
    startCol: Number.isFinite(Number(entry.startCol)) ? Number(entry.startCol) : null,
    endLine,
    endCol: Number.isFinite(Number(entry.endCol)) ? Number(entry.endCol) : null,
    snippet: entry.snippet || null,
    metadata: entry.metadata || null
  };
};

const readStructuralResults = async (jsonlPath, jsonPath) => {
  if (jsonlPath && fs.existsSync(jsonlPath)) {
    return readJsonLinesArray(jsonlPath);
  }
  if (jsonPath && fs.existsSync(jsonPath)) {
    const payload = readJsonFile(jsonPath);
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.results)) return payload.results;
  }
  return [];
};

export const loadStructuralMatches = async ({ repoRoot, repoCacheRoot, log }) => {
  if (!repoCacheRoot) return null;
  const baseDir = path.join(repoCacheRoot, 'structural');
  const jsonlPath = path.join(baseDir, 'structural.jsonl');
  const jsonPath = path.join(baseDir, 'structural.json');
  if (!fs.existsSync(jsonlPath) && !fs.existsSync(jsonPath)) return null;
  const entries = await readStructuralResults(jsonlPath, jsonPath);
  if (!entries.length) return null;
  const matchesByFile = new Map();
  let accepted = 0;
  for (const entry of entries) {
    const normalized = normalizeMatch(repoRoot, entry);
    if (!normalized) continue;
    const list = matchesByFile.get(normalized.path) || [];
    list.push(normalized);
    matchesByFile.set(normalized.path, list);
    accepted += 1;
  }
  if (log) {
    log(`Structural matches loaded: ${accepted} entries (${matchesByFile.size} files).`);
  }
  return matchesByFile;
};
