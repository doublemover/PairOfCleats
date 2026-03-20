import fs from 'node:fs';
import path from 'node:path';
import { isPathInsideRepo, resolveExcerpt } from '../excerpt-cache.js';

export const CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP = 3;
export const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES = 192;
export const CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS = 24;

export const normalizeRiskCallSiteDetails = (row) => {
  if (!row || typeof row !== 'object') return null;
  return {
    callSiteId: row.callSiteId || null,
    file: row.file || null,
    languageId: row.languageId || null,
    startLine: Number.isFinite(row.startLine) ? row.startLine : null,
    startCol: Number.isFinite(row.startCol) ? row.startCol : null,
    endLine: Number.isFinite(row.endLine) ? row.endLine : null,
    endCol: Number.isFinite(row.endCol) ? row.endCol : null,
    calleeRaw: row.calleeRaw || null,
    calleeNormalized: row.calleeNormalized || null,
    args: Array.isArray(row.args) ? row.args.slice(0, CONTEXT_PACK_MAX_RISK_CALL_SITES_PER_STEP) : []
  };
};

export const resolveRiskCallSiteExcerpt = ({ row, repoRoot }) => {
  if (!row?.file || !repoRoot) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'unavailable' }
    };
  }
  const filePath = path.resolve(repoRoot, row.file);
  if (!isPathInsideRepo(repoRoot, filePath)) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'outside-repo' }
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'missing-file' }
    };
  }
  if (!Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end <= row.start) {
    return {
      excerpt: null,
      excerptHash: null,
      excerptTruncated: false,
      excerptTruncation: { bytes: false, tokens: false },
      provenance: { artifact: 'call_sites', excerptSource: 'missing-range' }
    };
  }
  const resolvedExcerpt = resolveExcerpt({
    filePath,
    start: row.start,
    end: row.end,
    maxBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
    maxTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
  });
  return {
    excerpt: resolvedExcerpt.excerpt || null,
    excerptHash: resolvedExcerpt.excerptHash || null,
    excerptTruncated: resolvedExcerpt.truncated === true,
    excerptTruncation: {
      bytes: resolvedExcerpt.truncatedBytes === true,
      tokens: resolvedExcerpt.truncatedTokens === true
    },
    provenance: {
      artifact: 'call_sites',
      excerptSource: 'repo-range',
      maxBytes: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_BYTES,
      maxTokens: CONTEXT_PACK_MAX_RISK_CALL_SITE_EXCERPT_TOKENS
    }
  };
};

export const hydrateRiskCallSiteDetails = ({ row, repoRoot }) => {
  const base = normalizeRiskCallSiteDetails(row);
  if (!base) return { details: null, excerptTruncated: false };
  const excerpt = resolveRiskCallSiteExcerpt({ row, repoRoot });
  return {
    details: {
      ...base,
      excerpt: excerpt.excerpt,
      excerptHash: excerpt.excerptHash,
      excerptTruncated: excerpt.excerptTruncated,
      excerptTruncation: excerpt.excerptTruncation,
      provenance: excerpt.provenance
    },
    excerptTruncated: excerpt.excerptTruncated,
    excerptTruncation: excerpt.excerptTruncation
  };
};
