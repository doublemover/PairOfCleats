import fs from 'node:fs/promises';
import { readTextFileWithHash } from '../../../shared/encoding.js';
import { sha1 } from '../../../shared/hash.js';
import { extractPdf } from '../../extractors/pdf.js';
import { extractDocx } from '../../extractors/docx.js';
import {
  EXTRACTION_NORMALIZATION_POLICY,
  sha256Hex
} from '../../extractors/common.js';
import {
  buildDocxExtractionText,
  buildPdfExtractionText
} from './extraction.js';
import {
  compactDocsSearchJsonText,
  isDocsSearchIndexJsonPath
} from './docs-search-json.js';
import { resolveBinarySkip } from './skip.js';

/**
 * Normalize extractor units into stable, serializable metadata.
 *
 * @param {Array<object>} units
 * @returns {Array<object>}
 */
const buildDocumentExtractionUnits = (units) => {
  const nextUnits = [];
  for (const unit of units || []) {
    const nextUnit = {
      type: unit.type,
      start: unit.start,
      end: unit.end
    };
    if (Number.isFinite(unit.pageNumber)) nextUnit.pageNumber = unit.pageNumber;
    if (Number.isFinite(unit.index)) nextUnit.index = unit.index;
    if (unit.style) nextUnit.style = unit.style;
    nextUnits.push(nextUnit);
  }
  return nextUnits;
};

const buildDocumentExtractionInfo = ({
  sourceType,
  extracted,
  joined,
  sourceHashBuffer
}) => ({
  sourceType,
  status: 'ok',
  extractor: extracted.extractor || null,
  sourceBytesHash: sourceHashBuffer ? sha256Hex(sourceHashBuffer) : null,
  sourceBytesHashAlgo: 'sha256',
  counts: joined.counts,
  units: buildDocumentExtractionUnits(joined.units),
  normalizationPolicy: EXTRACTION_NORMALIZATION_POLICY,
  warnings: extracted.warnings || []
});

/**
 * Resolve text/hash/encoding artifacts before CPU analysis handoff.
 *
 * @param {object} options
 * @param {string} options.abs
 * @param {string} options.relKey
 * @param {string} options.mode
 * @param {string} options.ext
 * @param {object} options.fileStat
 * @param {object} options.fileScanner
 * @param {(fn:Function)=>Promise<any>} options.runIo
 * @param {Function} options.throwIfAborted
 * @param {(substage:string,extra?:object)=>void} options.updateCrashStage
 * @param {(err:any)=>object} options.formatCrashErrorMeta
 * @param {(fileKey:string,info:object)=>void} options.warnEncodingFallback
 * @param {'pdf'|'docx'|null} options.documentSourceType
 * @param {object} options.documentExtractionPolicy
 * @param {object} options.artifacts
 * @returns {Promise<{skip:object|null}>}
 */
export async function resolvePreCpuFileContent({
  abs,
  relKey,
  mode,
  ext,
  fileStat,
  fileScanner,
  runIo,
  throwIfAborted,
  updateCrashStage,
  formatCrashErrorMeta,
  warnEncodingFallback,
  documentSourceType,
  documentExtractionPolicy,
  artifacts
}) {
  if (!artifacts.fileBuffer) {
    throwIfAborted();
    updateCrashStage('pre-cpu:read-file:start');
    try {
      artifacts.fileBuffer = await runIo(() => fs.readFile(abs));
      updateCrashStage('pre-cpu:read-file:done', {
        bytes: Buffer.isBuffer(artifacts.fileBuffer) ? artifacts.fileBuffer.length : null
      });
    } catch (err) {
      const code = err?.code || null;
      updateCrashStage('pre-cpu:read-file:error', formatCrashErrorMeta(err));
      const reason = (code === 'EACCES' || code === 'EPERM' || code === 'EISDIR')
        ? 'unreadable'
        : 'read-failure';
      return {
        skip: {
          reason,
          code,
          message: err?.message || String(err)
        }
      };
    }
  }

  if (documentSourceType) {
    updateCrashStage('pre-cpu:extract:start', { sourceType: documentSourceType });
    const extracted = documentSourceType === 'pdf'
      ? await extractPdf({
        filePath: abs,
        buffer: artifacts.fileBuffer,
        policy: documentExtractionPolicy
      })
      : await extractDocx({
        filePath: abs,
        buffer: artifacts.fileBuffer,
        policy: documentExtractionPolicy
      });
    updateCrashStage('pre-cpu:extract:done', {
      ok: extracted?.ok === true,
      sourceType: documentSourceType
    });
    if (!extracted?.ok) {
      updateCrashStage('pre-cpu:skip:extract', {
        reason: extracted?.reason || 'extract_failed',
        sourceType: documentSourceType
      });
      return {
        skip: {
          reason: extracted?.reason || 'extract_failed',
          stage: 'extract',
          sourceType: documentSourceType,
          warnings: extracted?.warnings || []
        }
      };
    }
    const joined = documentSourceType === 'pdf'
      ? buildPdfExtractionText(extracted.pages)
      : buildDocxExtractionText(extracted.paragraphs);
    if (!joined.text) {
      updateCrashStage('pre-cpu:skip:unsupported-scanned', {
        sourceType: documentSourceType
      });
      return {
        skip: {
          reason: 'unsupported_scanned',
          stage: 'extract',
          sourceType: documentSourceType
        }
      };
    }
    artifacts.text = joined.text;
    let sourceHashBuffer = Buffer.isBuffer(artifacts.fileBuffer) ? artifacts.fileBuffer : null;
    if (!sourceHashBuffer) {
      try {
        updateCrashStage('pre-cpu:extract:source-read:start');
        sourceHashBuffer = await runIo(() => fs.readFile(abs));
        updateCrashStage('pre-cpu:extract:source-read:done', {
          bytes: Buffer.isBuffer(sourceHashBuffer) ? sourceHashBuffer.length : null
        });
        if (Buffer.isBuffer(sourceHashBuffer)) artifacts.fileBuffer = sourceHashBuffer;
      } catch {
        updateCrashStage('pre-cpu:extract:source-read:error');
        sourceHashBuffer = null;
      }
    }
    if (!artifacts.fileHash && sourceHashBuffer) {
      artifacts.fileHash = sha1(sourceHashBuffer);
      artifacts.fileHashAlgo = 'sha1';
    }
    artifacts.fileEncoding = 'document-extracted';
    artifacts.fileEncodingFallback = null;
    artifacts.fileEncodingConfidence = null;
    artifacts.documentExtraction = buildDocumentExtractionInfo({
      sourceType: documentSourceType,
      extracted,
      joined,
      sourceHashBuffer
    });
    return { skip: null };
  }

  updateCrashStage('pre-cpu:resolve-binary-skip:start');
  const binarySkip = await resolveBinarySkip({
    abs,
    fileBuffer: artifacts.fileBuffer,
    fileScanner
  });
  updateCrashStage('pre-cpu:resolve-binary-skip:done', {
    skipped: Boolean(binarySkip)
  });
  if (binarySkip) {
    updateCrashStage('pre-cpu:skip:binary', { reason: binarySkip.reason || 'binary' });
    return { skip: binarySkip };
  }

  if (!artifacts.text || !artifacts.fileHash) {
    updateCrashStage('pre-cpu:decode:start');
    const decoded = await readTextFileWithHash(abs, {
      buffer: artifacts.fileBuffer,
      stat: fileStat
    });
    updateCrashStage('pre-cpu:decode:done', {
      bytes: Buffer.isBuffer(artifacts.fileBuffer) ? artifacts.fileBuffer.length : null,
      encoding: decoded?.encoding || null
    });
    if (!artifacts.text) artifacts.text = decoded.text;
    if (!artifacts.fileHash) {
      artifacts.fileHash = decoded.hash;
      artifacts.fileHashAlgo = 'sha1';
    }
    artifacts.fileEncoding = decoded.encoding || artifacts.fileEncoding;
    artifacts.fileEncodingFallback = decoded.usedFallback;
    artifacts.fileEncodingConfidence = decoded.confidence;
    warnEncodingFallback(relKey, {
      encoding: artifacts.fileEncoding,
      encodingFallback: artifacts.fileEncodingFallback,
      encodingConfidence: artifacts.fileEncodingConfidence
    });
  }

  if (isDocsSearchIndexJsonPath({ mode, ext, relPath: relKey })) {
    const compacted = compactDocsSearchJsonText(artifacts.text);
    if (typeof compacted === 'string' && compacted.length > 0) {
      artifacts.text = compacted;
    }
  }
  return { skip: null };
}
