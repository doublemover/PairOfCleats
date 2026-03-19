#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import { loadUserConfig } from '../dict-utils/config.js';
import { getIndexDir, getRepoRoot } from '../dict-utils/paths/repo.js';

const DEFAULT_LIMIT = 25;
const DEFAULT_SYMBOL_LIMIT = 200;

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const readFlagValue = (args, name) => {
  const flag = `--${name}`;
  const flagEq = `${flag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === flag) {
      const next = args[i + 1];
      return next ? String(next) : null;
    }
    if (arg.startsWith(flagEq)) {
      return arg.slice(flagEq.length);
    }
  }
  return null;
};

const hasFlag = (args, name) => args.includes(`--${name}`);

const toPositiveInt = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.floor(numeric)) : fallback;
};

const buildLineIndex = (text) => {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
};

const offsetToPosition = (starts, offset) => {
  const safeOffset = Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= safeOffset) low = mid;
    else high = mid - 1;
  }
  const lineStart = starts[low] || 0;
  return {
    line: low + 1,
    col: Math.max(1, safeOffset - lineStart + 1)
  };
};

const createFilePositionResolver = () => {
  const cache = new Map();
  return (filePath, range) => {
    if (!filePath || !range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return null;
    const resolved = path.resolve(filePath);
    let entry = cache.get(resolved);
    if (!entry) {
      try {
        const text = fs.readFileSync(resolved, 'utf8');
        entry = { starts: buildLineIndex(text) };
      } catch {
        entry = null;
      }
      cache.set(resolved, entry);
    }
    if (!entry) return null;
    const start = offsetToPosition(entry.starts, range.start);
    const end = offsetToPosition(entry.starts, Math.max(range.start, range.end));
    return {
      startLine: start.line,
      startCol: start.col,
      endLine: end.line,
      endCol: end.col
    };
  };
};

const matchesSymbolQuery = (row, query) => {
  const exact = normalizeText(query);
  if (!exact) return false;
  const exactLower = exact.toLowerCase();
  const candidates = [
    row?.name,
    row?.qualifiedName,
    row?.symbolId,
    row?.scopedId,
    row?.symbolKey
  ].map((value) => normalizeText(value)).filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === exact) return true;
    const lower = candidate.toLowerCase();
    if (lower === exactLower) return true;
    if (lower.endsWith(`.${exactLower}`)) return true;
    if (lower.endsWith(`/${exactLower}`)) return true;
    if (lower.endsWith(`:${exactLower}`)) return true;
  }
  return false;
};

const scoreSymbolMatch = (row, { query, virtualPath }) => {
  let score = 0;
  const exact = normalizeText(query);
  const exactLower = exact.toLowerCase();
  if (normalizeText(row?.name) === exact) score += 8;
  else if (normalizeLower(row?.name) === exactLower) score += 7;
  if (normalizeText(row?.qualifiedName) === exact) score += 6;
  else if (normalizeLower(row?.qualifiedName).endsWith(`.${exactLower}`)) score += 5;
  if (virtualPath && normalizeText(row?.virtualPath) === normalizeText(virtualPath)) score += 3;
  return score;
};

const compareNavigationRows = (left, right) => {
  if ((right.score || 0) !== (left.score || 0)) return (right.score || 0) - (left.score || 0);
  if ((left.startLine || 0) !== (right.startLine || 0)) return (left.startLine || 0) - (right.startLine || 0);
  const fileCmp = normalizeText(left.virtualPath || left.file).localeCompare(normalizeText(right.virtualPath || right.file));
  if (fileCmp !== 0) return fileCmp;
  return normalizeText(left.name).localeCompare(normalizeText(right.name));
};

const refMatchesSymbolIds = (ref, symbolIds, query) => {
  const exact = normalizeText(query);
  if (!ref || typeof ref !== 'object') return false;
  const resolved = ref.resolved && typeof ref.resolved === 'object' ? ref.resolved : null;
  const candidates = Array.isArray(ref.candidates) ? ref.candidates : [];
  const targetName = normalizeText(ref.targetName);
  const endpoints = [resolved, ...candidates].filter(Boolean);
  for (const endpoint of endpoints) {
    if (symbolIds.has(normalizeText(endpoint.symbolId))) return true;
    if (symbolIds.has(normalizeText(endpoint.scopedId))) return true;
    if (symbolIds.has(normalizeText(endpoint.symbolKey))) return true;
  }
  return targetName && targetName === exact;
};

const relativeVirtualPath = (repoRoot, filePath) => {
  const root = normalizeText(repoRoot);
  const target = normalizeText(filePath);
  if (!root || !target) return '';
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative.replace(/\\/g, '/');
};

export const queryNavigationData = async ({
  repoRoot,
  kind,
  query = '',
  filePath = '',
  limit = DEFAULT_LIMIT,
  symbolLimit = DEFAULT_SYMBOL_LIMIT
}) => {
  const userConfig = loadUserConfig(repoRoot);
  const indexDir = getIndexDir(repoRoot, 'code', userConfig);
  const normalizedKind = normalizeText(kind).toLowerCase();
  const normalizedQuery = normalizeText(query);
  const normalizedFilePath = normalizeText(filePath);
  const normalizedVirtualPath = relativeVirtualPath(repoRoot, normalizedFilePath);
  const resolvedLimit = toPositiveInt(limit, DEFAULT_LIMIT);
  const resolvedSymbolLimit = toPositiveInt(symbolLimit, DEFAULT_SYMBOL_LIMIT);
  const payload = {
    ok: true,
    kind: normalizedKind,
    repoRoot,
    indexDir,
    query: normalizedQuery,
    filePath: normalizedFilePath || null,
    virtualPath: normalizedVirtualPath || null,
    degraded: [],
    results: []
  };
  const readArtifact = async (name) => {
    const legacyJsonPath = path.join(indexDir, `${name}.json`);
    if (fs.existsSync(legacyJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    try {
      const rows = await loadJsonArrayArtifact(indexDir, name, { strict: false });
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  if (!fs.existsSync(indexDir)) {
    payload.ok = false;
    payload.code = 'INDEX_MISSING';
    payload.message = `Missing code index at ${indexDir}.`;
    return payload;
  }

  const selectedSymbols = [];
  const wantedChunkUids = new Set();
  const symbolRows = await readArtifact('symbols');
  if (normalizedKind === 'document-symbols') {
    for (const row of symbolRows) {
      if (!row || normalizeText(row.virtualPath) !== normalizedVirtualPath) continue;
      selectedSymbols.push(row);
      if (row.chunkUid) wantedChunkUids.add(String(row.chunkUid));
      if (selectedSymbols.length >= resolvedSymbolLimit) break;
    }
  } else {
    for (const row of symbolRows) {
      if (!matchesSymbolQuery(row, normalizedQuery)) continue;
      selectedSymbols.push(row);
      if (row.chunkUid) wantedChunkUids.add(String(row.chunkUid));
      if (selectedSymbols.length >= resolvedLimit * 8) break;
    }
  }

  const chunkByUid = new Map();
  if (wantedChunkUids.size) {
    for (const row of await readArtifact('chunk_meta')) {
      const chunkUid = normalizeText(row?.chunkUid);
      if (!chunkUid || !wantedChunkUids.has(chunkUid)) continue;
      if (!chunkByUid.has(chunkUid)) chunkByUid.set(chunkUid, row);
      if (chunkByUid.size >= wantedChunkUids.size) break;
    }
  }

  if (normalizedKind === 'definitions') {
    payload.results = selectedSymbols
      .map((row) => {
        const chunk = chunkByUid.get(normalizeText(row.chunkUid));
        return {
          name: normalizeText(row.name),
          qualifiedName: normalizeText(row.qualifiedName),
          kind: normalizeText(chunk?.kind || row.kind || row.kindGroup),
          file: normalizeText(chunk?.file || row.file),
          virtualPath: normalizeText(chunk?.virtualPath || row.virtualPath),
          chunkUid: normalizeText(row.chunkUid),
          startLine: Number.isFinite(chunk?.startLine) ? chunk.startLine : null,
          endLine: Number.isFinite(chunk?.endLine) ? chunk.endLine : null,
          startCol: 1,
          endCol: 1,
          score: scoreSymbolMatch(row, { query: normalizedQuery, virtualPath: normalizedVirtualPath })
        };
      })
      .filter((row) => row.file || row.virtualPath)
      .sort(compareNavigationRows)
      .slice(0, resolvedLimit);
    return payload;
  }

  if (normalizedKind === 'document-symbols') {
    payload.results = selectedSymbols
      .map((row) => {
        const chunk = chunkByUid.get(normalizeText(row.chunkUid));
        return {
          name: normalizeText(row.name) || normalizeText(chunk?.name),
          qualifiedName: normalizeText(row.qualifiedName),
          kind: normalizeText(chunk?.kind || row.kind || row.kindGroup),
          file: normalizeText(chunk?.file || row.file),
          virtualPath: normalizeText(chunk?.virtualPath || row.virtualPath),
          chunkUid: normalizeText(row.chunkUid),
          startLine: Number.isFinite(chunk?.startLine) ? chunk.startLine : null,
          endLine: Number.isFinite(chunk?.endLine) ? chunk.endLine : null,
          startCol: 1,
          endCol: 1,
          score: Number.isFinite(chunk?.startLine) ? -chunk.startLine : 0
        };
      })
      .filter((row) => row.name && (row.file || row.virtualPath))
      .sort((left, right) => {
        if ((left.startLine || 0) !== (right.startLine || 0)) return (left.startLine || 0) - (right.startLine || 0);
        return normalizeText(left.name).localeCompare(normalizeText(right.name));
      })
      .slice(0, resolvedSymbolLimit);
    return payload;
  }

  if (normalizedKind !== 'references') {
    payload.ok = false;
    payload.code = 'INVALID_KIND';
    payload.message = `Unsupported navigation kind: ${normalizedKind}`;
    return payload;
  }

  const symbolIds = new Set();
  for (const row of selectedSymbols) {
    for (const value of [row?.symbolId, row?.scopedId, row?.symbolKey]) {
      const normalized = normalizeText(value);
      if (normalized) symbolIds.add(normalized);
    }
  }
  if (!symbolIds.size && !normalizedQuery) {
    return payload;
  }

  const occurrences = [];
  const occurrenceChunkUids = new Set();
  for (const row of await readArtifact('symbol_occurrences')) {
    if (!refMatchesSymbolIds(row?.ref, symbolIds, normalizedQuery)) continue;
    occurrences.push(row);
    const chunkUid = normalizeText(row?.host?.chunkUid);
    if (chunkUid) occurrenceChunkUids.add(chunkUid);
    if (occurrences.length >= resolvedLimit * 8) break;
  }

  for (const row of await readArtifact('chunk_meta')) {
    const chunkUid = normalizeText(row?.chunkUid);
    if (!chunkUid || !occurrenceChunkUids.has(chunkUid)) continue;
    if (!chunkByUid.has(chunkUid)) chunkByUid.set(chunkUid, row);
    if (occurrenceChunkUids.size === 0 || chunkByUid.size >= (wantedChunkUids.size + occurrenceChunkUids.size)) break;
  }

  const resolveFileRange = createFilePositionResolver();
  const seen = new Set();
  payload.results = occurrences
    .map((row) => {
      const chunkUid = normalizeText(row?.host?.chunkUid);
      const chunk = chunkByUid.get(chunkUid);
      const file = normalizeText(chunk?.file || row?.host?.file);
      const virtualPath = normalizeText(chunk?.virtualPath || relativeVirtualPath(repoRoot, file));
      const range = resolveFileRange(file, row?.range) || null;
      return {
        name: normalizeText(normalizedQuery),
        qualifiedName: normalizeText(normalizedQuery),
        kind: normalizeText(chunk?.kind),
        file,
        virtualPath,
        chunkUid,
        startLine: range?.startLine ?? (Number.isFinite(chunk?.startLine) ? chunk.startLine : null),
        endLine: range?.endLine ?? (Number.isFinite(chunk?.endLine) ? chunk.endLine : null),
        startCol: range?.startCol ?? 1,
        endCol: range?.endCol ?? 1,
        score: virtualPath === normalizedVirtualPath ? 2 : 0
      };
    })
    .filter((row) => row.file || row.virtualPath)
    .filter((row) => {
      const key = [
        row.file,
        row.startLine,
        row.startCol,
        row.endLine,
        row.endCol
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareNavigationRows)
    .slice(0, resolvedLimit);

  return payload;
};

const printUsage = () => {
  process.stderr.write(
    'Usage: pairofcleats tooling navigate --kind <definitions|references|document-symbols> [--symbol <name>] [--file <path>] [--repo <root>] [--top N] [--json]\n'
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const kind = readFlagValue(argv, 'kind');
  const query = readFlagValue(argv, 'symbol') || '';
  const filePath = readFlagValue(argv, 'file') || '';
  const repoOverride = readFlagValue(argv, 'repo');
  const limit = toPositiveInt(readFlagValue(argv, 'top'), DEFAULT_LIMIT);
  const json = hasFlag(argv, 'json');
  if (!kind) {
    printUsage();
    process.exit(1);
  }
  if (normalizeText(kind).toLowerCase() !== 'document-symbols' && !normalizeText(query)) {
    printUsage();
    process.exit(1);
  }
  const repoRoot = getRepoRoot(repoOverride || null, process.cwd());
  const payload = await queryNavigationData({
    repoRoot,
    kind,
    query,
    filePath,
    limit
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (!payload.ok) {
    process.stderr.write(`${payload.message || 'navigation query failed'}\n`);
  } else {
    process.stdout.write(`${payload.results.length} results\n`);
  }
  process.exit(payload.ok ? 0 : 1);
}
