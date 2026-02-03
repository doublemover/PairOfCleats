import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from '../shared/hash.js';
import {
  normalizeLimit,
  normalizeOptionalNumber
} from '../shared/limits.js';
import { resolveProvenance } from '../shared/provenance.js';
import { buildGraphContextPack } from '../graph/context-pack.js';
import { compareStrings } from '../shared/sort.js';

const resolveSeedRef = (seed) => {
  if (!seed || typeof seed !== 'object') return null;
  if (seed.type && typeof seed.type === 'string') return seed;
  if ('status' in seed) return seed;
  return null;
};

const resolveSeedCandidates = (seed) => {
  if (!seed || typeof seed !== 'object' || !('status' in seed)) return [];
  const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
  const resolved = seed.resolved && typeof seed.resolved === 'object' ? seed.resolved : null;
  const out = [];
  if (resolved) out.push(resolved);
  out.push(...candidates);
  return out;
};

const resolveChunkBySeed = (seedRef, chunkMeta, warnings) => {
  if (!Array.isArray(chunkMeta)) return null;
  const byChunkUid = new Map();
  const byFile = new Map();
  const bySymbol = new Map();
  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    const chunkUid = chunk.chunkUid || chunk.metaV2?.chunkUid || null;
    if (chunkUid && !byChunkUid.has(chunkUid)) byChunkUid.set(chunkUid, chunk);
    if (chunk.file) {
      const list = byFile.get(chunk.file) || [];
      list.push(chunk);
      byFile.set(chunk.file, list);
    }
    const symbolId = chunk.metaV2?.symbol?.symbolId || null;
    if (symbolId && !bySymbol.has(symbolId)) bySymbol.set(symbolId, chunk);
  }

  const resolveFromNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'chunk') return byChunkUid.get(node.chunkUid) || null;
    if (node.type === 'file') {
      const list = byFile.get(node.path) || [];
      return list[0] || null;
    }
    if (node.type === 'symbol') return bySymbol.get(node.symbolId) || null;
    return null;
  };

  if (seedRef?.type) {
    const chunk = resolveFromNode(seedRef);
    if (!chunk) {
      warnings.push({
        code: 'SEED_NOT_FOUND',
        message: `Seed ${seedRef.type} could not be resolved to chunk metadata.`
      });
    }
    return chunk;
  }

  if (seedRef && 'status' in seedRef) {
    const candidates = resolveSeedCandidates(seedRef);
    for (const candidate of candidates) {
      const chunk = resolveFromNode(candidate);
      if (chunk) return chunk;
    }
    warnings.push({
      code: 'SEED_UNRESOLVED',
      message: 'Seed reference envelope could not be resolved to a chunk.'
    });
  }
  return null;
};

const resolvePrimaryRef = (seedRef, chunk) => {
  if (seedRef?.type) return seedRef;
  if (chunk?.chunkUid || chunk?.metaV2?.chunkUid) {
    return { type: 'chunk', chunkUid: chunk.chunkUid || chunk.metaV2.chunkUid };
  }
  if (chunk?.file) return { type: 'file', path: chunk.file };
  return seedRef || null;
};

const trimUtf8Buffer = (buffer) => {
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] & 0xC0) === 0x80) {
    end -= 1;
  }
  if (end === 0) return buffer.subarray(0, 0);
  const lead = buffer[end - 1];
  let needed = 1;
  if ((lead & 0x80) === 0) needed = 1;
  else if ((lead & 0xE0) === 0xC0) needed = 2;
  else if ((lead & 0xF0) === 0xE0) needed = 3;
  else if ((lead & 0xF8) === 0xF0) needed = 4;
  if (end - 1 + needed <= buffer.length) {
    return buffer;
  }
  return buffer.subarray(0, Math.max(0, end - 1));
};

const readFilePrefix = (filePath, maxBytes) => {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const slice = trimUtf8Buffer(buffer.subarray(0, bytesRead));
    return slice.toString('utf8');
  } finally {
    if (fd) fs.closeSync(fd);
  }
};

const isPathInsideRepo = (repoRoot, filePath) => {
  const relative = path.relative(repoRoot, filePath);
  if (!relative) return true;
  if (relative.startsWith('..')) return false;
  return !path.isAbsolute(relative);
};

const sliceExcerpt = (text, maxBytes, maxTokens) => {
  let excerpt = text;
  let truncated = false;
  if (maxBytes != null && maxBytes > 0) {
    const buffer = Buffer.from(excerpt, 'utf8');
    if (buffer.length > maxBytes) {
      const safe = trimUtf8Buffer(buffer.subarray(0, maxBytes));
      excerpt = safe.toString('utf8');
      truncated = true;
    }
  }
  if (maxTokens != null && maxTokens > 0) {
    const tokens = excerpt.split(/\s+/).filter(Boolean);
    if (tokens.length > maxTokens) {
      excerpt = tokens.slice(0, maxTokens).join(' ');
      truncated = true;
    }
  }
  return { excerpt, truncated };
};

const buildPrimaryExcerpt = ({ chunk, repoRoot, maxBytes, maxTokens, warnings }) => {
  if (!chunk) {
    warnings.push({ code: 'MISSING_PRIMARY', message: 'Primary chunk not found for seed.' });
    return { excerpt: '', excerptHash: null, file: null, range: null, truncated: false };
  }
  const filePath = chunk.file ? path.resolve(repoRoot, chunk.file) : null;
  let text = '';
  if (filePath) {
    if (!isPathInsideRepo(repoRoot, filePath)) {
      warnings.push({
        code: 'PRIMARY_PATH_OUTSIDE_REPO',
        message: 'Primary chunk path resolves outside repo root.'
      });
    } else if (fs.existsSync(filePath)) {
      const start = Number.isFinite(chunk.start) ? chunk.start : null;
      const end = Number.isFinite(chunk.end) ? chunk.end : null;
      const maxBytesNum = normalizeOptionalNumber(maxBytes);
      if (maxBytesNum && (start == null || end == null || end <= start)) {
        text = readFilePrefix(filePath, maxBytesNum);
      } else {
        const fileText = fs.readFileSync(filePath, 'utf8');
        const safeStart = Number.isFinite(start) ? start : 0;
        const safeEnd = Number.isFinite(end) ? end : fileText.length;
        if (safeEnd > safeStart) {
          text = fileText.slice(safeStart, safeEnd);
        } else {
          text = fileText;
        }
      }
    } else {
      warnings.push({
        code: 'PRIMARY_PATH_MISSING',
        message: 'Primary chunk path not found on disk.'
      });
    }
  } else if (chunk.headline) {
    text = String(chunk.headline);
  } else if (chunk.docmeta?.doc) {
    text = String(chunk.docmeta.doc);
  }

  const { excerpt, truncated } = sliceExcerpt(
    text,
    normalizeOptionalNumber(maxBytes),
    normalizeOptionalNumber(maxTokens)
  );
  if (truncated) {
    warnings.push({
      code: 'PRIMARY_EXCERPT_TRUNCATED',
      message: 'Primary excerpt truncated due to maxBytes/maxTokens.'
    });
  }
  const excerptHash = excerpt ? sha1(excerpt) : null;
  const range = (Number.isFinite(chunk.startLine) || Number.isFinite(chunk.endLine))
    ? {
      startLine: Number.isFinite(chunk.startLine) ? chunk.startLine : null,
      endLine: Number.isFinite(chunk.endLine) ? chunk.endLine : null
    }
    : null;
  return {
    excerpt,
    excerptHash,
    file: chunk.file || null,
    range,
    truncated
  };
};

const normalizeTypeFacts = (seedRef, chunk, maxTypeEntries, warnings) => {
  if (!chunk?.docmeta?.inferredTypes) {
    warnings.push({
      code: 'MISSING_TYPES',
      message: 'No inferred types found for seed.'
    });
    return [];
  }
  const facts = [];
  const pushFacts = (role, entries) => {
    if (!entries || typeof entries !== 'object') return;
    for (const [name, types] of Object.entries(entries)) {
      const list = Array.isArray(types) ? types : [];
      for (const entry of list) {
        if (!entry?.type) continue;
        facts.push({
          subject: seedRef,
          role: `${role}:${name}`,
          name,
          type: entry.type,
          source: entry.source || null,
          confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
        });
      }
    }
  };
  pushFacts('param', chunk.docmeta.inferredTypes.params);
  pushFacts('field', chunk.docmeta.inferredTypes.fields);
  pushFacts('local', chunk.docmeta.inferredTypes.locals);
  const returns = Array.isArray(chunk.docmeta.inferredTypes.returns)
    ? chunk.docmeta.inferredTypes.returns
    : [];
  for (const entry of returns) {
    if (!entry?.type) continue;
    facts.push({
      subject: seedRef,
      role: 'return',
      name: null,
      type: entry.type,
      source: entry.source || null,
      confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
    });
  }
  facts.sort((a, b) => compareStrings(a.role, b.role) || compareStrings(a.type, b.type));
  if (Number.isFinite(maxTypeEntries) && maxTypeEntries >= 0 && facts.length > maxTypeEntries) {
    warnings.push({
      code: 'TYPES_TRUNCATED',
      message: 'Type facts truncated due to maxTypeEntries.'
    });
    return facts.slice(0, maxTypeEntries);
  }
  return facts;
};

export const assembleCompositeContextPack = ({
  seed = null,
  chunkMeta = null,
  repoRoot = process.cwd(),
  graphRelations = null,
  symbolEdges = null,
  callSites = null,
  includeGraph = true,
  includeTypes = false,
  includeRisk = false,
  includeImports = true,
  includeUsages = true,
  includeCallersCallees = true,
  includePaths = false,
  depth = 1,
  maxBytes = null,
  maxTokens = null,
  maxTypeEntries = null,
  caps = {},
  provenance = null,
  indexSignature = null,
  indexCompatKey = null,
  repo = null,
  indexDir = null,
  now = () => new Date().toISOString()
} = {}) => {
  const warnings = [];
  const truncation = [];
  const seedRef = resolveSeedRef(seed);
  const primaryChunk = resolveChunkBySeed(seedRef, chunkMeta, warnings);
  const primaryRef = resolvePrimaryRef(seedRef, primaryChunk);

  const primary = {
    ref: primaryRef || { type: 'chunk', chunkUid: null },
    file: null,
    range: null,
    excerpt: '',
    excerptHash: null,
    provenance: null
  };
  const excerptPayload = buildPrimaryExcerpt({
    chunk: primaryChunk,
    repoRoot,
    maxBytes,
    maxTokens,
    warnings
  });
  primary.file = excerptPayload.file;
  primary.range = excerptPayload.range;
  primary.excerpt = excerptPayload.excerpt;
  primary.excerptHash = excerptPayload.excerptHash;

  let graph = null;
  if (includeGraph && primaryRef) {
    const graphs = [];
    if (includeCallersCallees) graphs.push('callGraph');
    if (includeUsages) graphs.push('usageGraph');
    if (includeImports) graphs.push('importGraph');
    const edgeFilters = graphs.length ? { graphs } : null;
    graph = buildGraphContextPack({
      seed: primaryRef,
      graphRelations,
      symbolEdges,
      callSites,
      direction: 'both',
      depth: normalizeLimit(depth, 1),
      edgeFilters,
      caps,
      includePaths,
      indexSignature,
      indexCompatKey,
      repo,
      indexDir,
      now
    });
    if (Array.isArray(graph?.warnings)) {
      warnings.push(...graph.warnings);
    }
    if (Array.isArray(graph?.truncation)) {
      truncation.push(...graph.truncation);
    }
  } else if (includeGraph) {
    warnings.push({ code: 'MISSING_GRAPH', message: 'Graph slice omitted due to missing seed.' });
  }

  let types = null;
  if (includeTypes) {
    const facts = normalizeTypeFacts(primaryRef || seedRef, primaryChunk, maxTypeEntries, warnings);
    types = { facts };
  }

  let risk = null;
  if (includeRisk) {
    warnings.push({
      code: 'MISSING_RISK',
      message: 'Risk slice not available in this context pack.'
    });
    risk = { flows: [] };
  }

  const capsUsed = {
    graph: { ...caps },
    types: Number.isFinite(maxTypeEntries) ? { maxTypeEntries } : {}
  };
  const provenanceResolved = resolveProvenance({
    provenance,
    indexSignature,
    indexCompatKey,
    capsUsed,
    repo,
    indexDir,
    now,
    label: 'CompositeContextPack'
  });

  return {
    version: '1.0.0',
    seed: primaryRef || seedRef || { v: 1, status: 'unresolved', candidates: [], resolved: null },
    provenance: provenanceResolved,
    primary,
    graph,
    types,
    risk,
    truncation: truncation.length ? truncation : null,
    warnings: warnings.length ? warnings : null
  };
};
