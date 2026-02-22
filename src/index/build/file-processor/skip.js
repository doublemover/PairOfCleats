import path from 'node:path';
import { pickMinLimit, resolveFileCaps } from './read.js';
import { detectBinary, isMinifiedName, readFileSample } from '../file-scan.js';
import {
  buildGeneratedPolicyConfig,
  buildGeneratedPolicyDowngradePayload,
  resolveGeneratedPolicyDecision
} from '../generated-policy.js';

const isGeneratedDocsetPath = (absPath) => {
  const normalized = String(absPath || '').replace(/\\/g, '/').toLowerCase();
  // Restrict to generated docset bundle payload trees to avoid skipping
  // first-party source paths like src/docset/*.
  if (normalized.includes('.docset/contents/resources/documents/')) return true;
  if (normalized.includes('/docsets/') && normalized.includes('/contents/resources/documents/')) return true;
  if (normalized.includes('/docs/docset/contents/resources/documents/')) return true;
  return false;
};

const EXTRACTED_PROSE_ALLOWED_EXTS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.txt',
  '.pdf',
  '.docx',
  '.rtf',
  '.html',
  '.htm',
  '.xml'
]);
const EXTRACTED_PROSE_LOW_YIELD_PATHS = [
  '/node_modules/',
  '/vendor/',
  '/dist/',
  '/build/',
  '/coverage/',
  '/.git/'
];
const EXTRACTED_PROSE_MIN_BYTES = 256;

const normalizeProseProbePath = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

const resolveExtractedProsePrefilterPolicy = (generatedPolicy = null) => {
  if (!generatedPolicy || typeof generatedPolicy !== 'object') {
    return { enabled: true, minBytes: EXTRACTED_PROSE_MIN_BYTES };
  }
  const extractedProse = generatedPolicy.extractedProse && typeof generatedPolicy.extractedProse === 'object'
    ? generatedPolicy.extractedProse
    : {};
  const prefilter = extractedProse.prefilter && typeof extractedProse.prefilter === 'object'
    ? extractedProse.prefilter
    : {};
  const enabled = prefilter.enabled !== false;
  const minBytesRaw = Number(prefilter.minBytes);
  const minBytes = Number.isFinite(minBytesRaw) && minBytesRaw > 0
    ? Math.max(64, Math.floor(minBytesRaw))
    : EXTRACTED_PROSE_MIN_BYTES;
  return { enabled, minBytes };
};

export const resolveExtractedProsePrefilterDecision = ({
  relPath = null,
  absPath = null,
  ext = null,
  mode = null,
  languageId = null,
  fileStat = null,
  generatedPolicy = null
} = {}) => {
  if (mode !== 'extracted-prose') return null;
  const { enabled, minBytes } = resolveExtractedProsePrefilterPolicy(generatedPolicy);
  if (!enabled) return null;
  const normalizedExt = String(ext || '').trim().toLowerCase();
  const normalizedPath = normalizeProseProbePath(relPath || absPath || '');
  const fileBytes = Number(fileStat?.size);
  if (normalizedPath && EXTRACTED_PROSE_LOW_YIELD_PATHS.some((part) => normalizedPath.includes(part))) {
    return {
      reason: 'extracted-prose-prefilter',
      prefilterClass: 'low-yield-path',
      pathHint: normalizedPath
    };
  }
  if (EXTRACTED_PROSE_ALLOWED_EXTS.has(normalizedExt)) return null;
  if (Number.isFinite(fileBytes) && fileBytes > 0 && fileBytes < minBytes) {
    return {
      reason: 'extracted-prose-prefilter',
      prefilterClass: 'tiny-file',
      bytes: Math.floor(fileBytes),
      minBytes
    };
  }
  const normalizedLanguage = typeof languageId === 'string'
    ? languageId.trim().toLowerCase()
    : '';
  if (normalizedLanguage && normalizedLanguage !== 'markdown' && normalizedLanguage !== 'text') {
    return {
      reason: 'extracted-prose-prefilter',
      prefilterClass: 'code-language',
      languageId: normalizedLanguage
    };
  }
  if (normalizedExt && !EXTRACTED_PROSE_ALLOWED_EXTS.has(normalizedExt)) {
    return {
      reason: 'extracted-prose-prefilter',
      prefilterClass: 'non-doc-extension',
      ext: normalizedExt
    };
  }
  return null;
};

/**
 * Resolve pre-read skip decisions (caps/minified/binary scanner) before full
 * file decode. Supports a document-extraction bypass for binary/minified
 * reasons while still enforcing max-bytes and max-lines caps.
 *
 * @param {object} input
 * @param {boolean} [input.bypassBinaryMinifiedSkip=false]
 * @returns {Promise<object|null>}
 */
export async function resolvePreReadSkip({
  abs,
  rel = null,
  fileEntry,
  fileStat,
  ext,
  fileCaps,
  fileScanner,
  runIo,
  languageId = null,
  mode = null,
  maxFileBytes = null,
  bypassBinaryMinifiedSkip = false,
  generatedPolicy = null
}) {
  const effectiveGeneratedPolicy = generatedPolicy && typeof generatedPolicy === 'object'
    ? generatedPolicy
    : buildGeneratedPolicyConfig({});
  // Records mode keeps deterministic record ingestion semantics and should not
  // be downgraded by generated/minified/vendor policy heuristics.
  const isRecordEntry = mode === 'records' || Boolean(fileEntry?.record);
  const shouldBypassSkipReason = (reason) => (
    (
      bypassBinaryMinifiedSkip === true
      && (reason === 'binary' || reason === 'minified')
    )
    || (isRecordEntry && reason === 'minified')
  );
  const shouldBypassPolicyDecision = (decision) => (
    bypassBinaryMinifiedSkip === true
    && decision?.classification === 'minified'
    && decision?.policy !== 'exclude'
  );
  const toGeneratedPolicySkip = (decision) => ({
    reason: decision?.classification || 'generated',
    indexMode: decision?.indexMode || 'metadata-only',
    downgrade: buildGeneratedPolicyDowngradePayload(decision)
  });
  const resolvePolicyDecision = (scanSkip = null) => resolveGeneratedPolicyDecision({
    generatedPolicy: effectiveGeneratedPolicy,
    relPath: rel || null,
    absPath: abs,
    baseName: path.basename(abs),
    scanSkip
  });
  const capsByExt = resolveFileCaps(fileCaps, ext, languageId, mode);
  const effectiveMaxBytes = pickMinLimit(maxFileBytes, capsByExt.maxBytes);
  if (effectiveMaxBytes && fileStat.size > effectiveMaxBytes) {
    return {
      reason: 'oversize',
      stage: 'pre-read',
      capSource: 'maxBytes',
      bytes: fileStat.size,
      maxBytes: effectiveMaxBytes
    };
  }
  const extractedProsePrefilterSkip = resolveExtractedProsePrefilterDecision({
    relPath: rel,
    absPath: abs,
    ext,
    mode,
    languageId,
    fileStat,
    generatedPolicy: effectiveGeneratedPolicy
  });
  if (extractedProsePrefilterSkip) {
    return extractedProsePrefilterSkip;
  }
  const scanState = fileEntry && typeof fileEntry === 'object' ? fileEntry.scan : null;
  const baselinePolicyDecision = isRecordEntry
    ? null
    : resolvePolicyDecision(scanState?.skip || null);
  if (baselinePolicyDecision?.downgrade) {
    if (shouldBypassPolicyDecision(baselinePolicyDecision)) {
      return null;
    }
    return toGeneratedPolicySkip(baselinePolicyDecision);
  }
  const allowMinifiedByPolicyInclude = baselinePolicyDecision?.policy === 'include'
    && baselinePolicyDecision?.indexMode === 'full';
  if (scanState?.skip) {
    const { reason, ...extra } = scanState.skip;
    const resolvedReason = reason || 'oversize';
    if (resolvedReason === 'minified' && allowMinifiedByPolicyInclude) {
      return null;
    }
    if (shouldBypassSkipReason(resolvedReason)) {
      // Document extraction can process PDF/DOCX bytes directly; keep size/line
      // caps enforced but bypass text-oriented pre-read binary/minified checks.
      return null;
    }
    return {
      reason: resolvedReason,
      ...(resolvedReason === 'oversize' ? { stage: 'pre-read' } : {}),
      ...extra
    };
  }
  if (isGeneratedDocsetPath(abs)) {
    return { reason: 'generated-docset' };
  }
  if (!isRecordEntry
    && !bypassBinaryMinifiedSkip
    && isMinifiedName(path.basename(abs))
    && !allowMinifiedByPolicyInclude) {
    return { reason: 'minified', method: 'name' };
  }
  const knownLines = Number(fileEntry?.lines);
  if (capsByExt.maxLines && Number.isFinite(knownLines) && knownLines > capsByExt.maxLines) {
    return {
      reason: 'oversize',
      stage: 'pre-read',
      capSource: 'maxLines',
      lines: knownLines,
      maxLines: capsByExt.maxLines
    };
  }
  if (!scanState?.checkedBinary || !scanState?.checkedMinified) {
    const scanResult = await runIo(() => fileScanner.scanFile({
      absPath: abs,
      stat: fileStat,
      ext,
      readSample: readFileSample
    }));
    if (scanResult?.skip) {
      const scanDecision = isRecordEntry ? null : resolvePolicyDecision(scanResult.skip);
      if (scanDecision?.downgrade) {
        if (shouldBypassPolicyDecision(scanDecision)) {
          return null;
        }
        return toGeneratedPolicySkip(scanDecision);
      }
      const { reason, ...extra } = scanResult.skip;
      const resolvedReason = reason || 'oversize';
      if (resolvedReason === 'minified' && scanDecision?.policy === 'include') {
        return null;
      }
      if (shouldBypassSkipReason(resolvedReason)) {
        return null;
      }
      return {
        reason: resolvedReason,
        ...(resolvedReason === 'oversize' ? { stage: 'pre-read' } : {}),
        ...extra
      };
    }
  }
  return null;
}

/**
 * Detect binary payloads after file bytes are already loaded.
 * @param {{abs:string,fileBuffer:Buffer,fileScanner:object}} input
 * @returns {Promise<object|null>}
 */
export async function resolveBinarySkip({ abs, fileBuffer, fileScanner }) {
  if (!fileBuffer || !fileBuffer.length) return null;
  const binarySkip = await detectBinary({
    absPath: abs,
    buffer: fileBuffer,
    maxNonTextRatio: fileScanner.binary?.maxNonTextRatio ?? 0.3
  });
  if (!binarySkip) return null;
  const { reason, ...extra } = binarySkip;
  return { reason: reason || 'binary', ...extra };
}
