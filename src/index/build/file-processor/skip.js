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
  const shouldBypassSkipReason = (reason) => (
    bypassBinaryMinifiedSkip === true
    && (reason === 'binary' || reason === 'minified')
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
  const scanState = fileEntry && typeof fileEntry === 'object' ? fileEntry.scan : null;
  const baselinePolicyDecision = resolvePolicyDecision(scanState?.skip || null);
  if (baselinePolicyDecision?.downgrade) {
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
  if (!bypassBinaryMinifiedSkip && isMinifiedName(path.basename(abs)) && !allowMinifiedByPolicyInclude) {
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
      const scanDecision = resolvePolicyDecision(scanResult.skip);
      if (scanDecision?.downgrade) {
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
