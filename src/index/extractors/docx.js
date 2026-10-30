import path from 'node:path';
import zlib from 'node:zlib';
import { decodeDocxXmlBytes } from './docx-xml-bytes.js';
import { readDocxXmlStructure, isWordNode as isWord, wordAttribute, parseDocxStyles } from './docx-xml-structure.js';
import { throwIfAborted, isAbortError } from '../../shared/abort.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { getDocumentExtractorTestConfig } from '../../shared/env/testing.js';
import {
  buildDocumentExtractionFidelity,
  buildFailedResult,
  normalizeDocumentExtractionPolicy,
  normalizeExtractedText,
  normalizeWarnings,
  DOCX_STRUCTURAL_EXTRACTION_VERSION
} from './common.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

let cachedRuntime = null;

const resolveDocxFailureReason = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();
  if (code === 'EXTRACT_TIMEOUT') return 'extract_timeout';
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_DOCX_EXPANDED_LIMIT' || code === 'ERR_DOCX_XML_LIMIT') return 'oversize';
  if (message.includes('encrypted')) return 'unsupported_encrypted';
  return 'extract_failed';
};

const hasEncryptedDocxEntries = (entries) => entries.some((entry) => {
  const name = String(entry?.name || '').toLowerCase();
  return name === 'encryptedpackage' || name === 'encryptioninfo';
});

const isEncryptedDocxBuffer = (buffer) => {
  try {
    const entries = parseCentralDirectory(buffer);
    return hasEncryptedDocxEntries(entries);
  } catch {
    return false;
  }
};

const findEndOfCentralDirectory = (buffer) => {
  const maxSearch = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= maxSearch; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  return -1;
};

const parseCentralDirectory = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('DOCX zip central directory not found');
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  if (buffer.readUInt16LE(eocdOffset + 4) || buffer.readUInt16LE(eocdOffset + 6)
    || buffer.readUInt16LE(eocdOffset + 8) !== totalEntries) throw new Error('Unsupported DOCX multi-disk zip directory.');
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralEnd = centralOffset + buffer.readUInt32LE(eocdOffset + 12);
  if (totalEntries > 10000 || centralOffset > eocdOffset || centralEnd !== eocdOffset) throw new Error('Invalid or oversized DOCX zip directory.');
  let cursor = centralOffset;
  const entries = [];
  const names = new Set();
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > centralEnd || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error('Truncated DOCX zip directory.');
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd + extraLength + commentLength > centralEnd) throw new Error('Truncated DOCX zip member identity.');
    const name = buffer.slice(nameStart, nameEnd).toString('utf8');
    if (names.has(name)) throw new Error('Duplicate DOCX zip member identity.');
    names.add(name);
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== centralEnd) throw new Error('DOCX zip member count does not match its directory.');
  return entries;
};

export const extractZipEntry = (buffer, entry, maxOutputBytes) => {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new TypeError('DOCX expanded XML requires a positive byte bound.');
  const oversize = () => Object.assign(new Error('DOCX expanded XML exceeds the extraction byte policy.'), { code: 'ERR_DOCX_EXPANDED_LIMIT' });
  if (entry.uncompressedSize > maxOutputBytes) throw oversize();
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length || dataEnd <= dataStart) return null;
  if (entry.name !== undefined && buffer.subarray(localOffset + 30, localOffset + 30 + fileNameLength).toString('utf8') !== entry.name) throw new Error('DOCX local/central member identities differ.');
  const payload = buffer.slice(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    if (payload.length > maxOutputBytes) throw oversize();
    return payload;
  }
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(payload, { maxOutputLength: maxOutputBytes });
  return null;
};

export const parseDocxParagraphsFromXml = (xml, { resolveHeadingLevel = null, ...options } = {}) => {
  const paragraphs = [], excludedRanges = new Set(); let paragraph = null, index = 0, excludedDepth = 0;
  readDocxXmlStructure(xml, { ...options, rootName: 'document',
    open(node, stack) {
      const physicalIndex = isWord(node, 'p') ? ++index : null;
      if (index > 100000) throw Object.assign(new Error('DOCX physical paragraph allowance exceeded.'), { code: 'ERR_DOCX_XML_LIMIT' });
      if (isWord(node, 'del') || isWord(node, 'moveFrom')) excludedDepth++;
      if (isWord(node, 'moveFromRangeStart')) {
        const id = wordAttribute(node, 'id');
        if (!id || excludedRanges.has(id)) throw new Error('Invalid DOCX moved-from range start.');
        excludedRanges.add(id);
      } else if (isWord(node, 'moveFromRangeEnd')) {
        const id = wordAttribute(node, 'id');
        if (!id || !excludedRanges.delete(id)) throw new Error('Invalid DOCX moved-from range end.');
      }
      if (excludedDepth || excludedRanges.size) return;
      if (isWord(node, 'p')) {
        if (paragraph) throw new Error('Nested DOCX paragraphs cannot be ordered.');
        paragraph = { index: physicalIndex, runs: [], style: null, outline: undefined };
      } else if (paragraph && isWord(stack.at(-1), 'pPr') && isWord(stack.at(-2), 'p') && isWord(node, 'pStyle')) paragraph.style = wordAttribute(node, 'val') || null;
      else if (paragraph && isWord(stack.at(-1), 'pPr') && isWord(stack.at(-2), 'p') && isWord(node, 'outlineLvl')) {
        const value = wordAttribute(node, 'val');
        if (!/^[0-9]$/.test(value || '')) throw new Error('DOCX outline level must be 0..9.');
        paragraph.outline = value === '9' ? null : Number(value) + 1;
      } else if (paragraph && (isWord(node, 'tab') || isWord(node, 'br') || isWord(node, 'cr'))) paragraph.runs.push(isWord(node, 'tab') ? '\t' : '\n');
    },
    text(value, stack) { if (paragraph && !excludedDepth && !excludedRanges.size && isWord(stack.at(-1), 't')) paragraph.runs.push(value); },
    close(node) {
      if (isWord(node, 'p') && !excludedDepth && paragraph) {
        const text = normalizeExtractedText(paragraph.runs.join(''));
        const heading = paragraph.outline !== undefined ? paragraph.outline : paragraph.style && resolveHeadingLevel ? resolveHeadingLevel(paragraph.style) : undefined;
        if (text) paragraphs.push({ index: paragraph.index, text,
          ...(paragraph.style ? { style: paragraph.style } : {}), ...(heading !== undefined ? { headingLevel: heading } : {}) });
        paragraph = null;
      }
      if (isWord(node, 'del') || isWord(node, 'moveFrom')) excludedDepth--;
    }
  });
  if (excludedRanges.size) throw new Error('Unclosed DOCX moved-from range.');
  return paragraphs;
};

const parseDocxParagraphsFromBuffer = (buffer, policy = null, signal = null) => {
  throwIfAborted(signal);
  const startedAt = performance.now();
  const entries = parseCentralDirectory(buffer);
  if (hasEncryptedDocxEntries(entries)) {
    return buildFailedResult('unsupported_encrypted', [], { sourceType: 'docx', policy });
  }
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) {
    return buildFailedResult('extract_failed', ['word/document.xml missing'], { sourceType: 'docx', policy });
  }
  const resolvedPolicy = normalizeDocumentExtractionPolicy(policy);
  const xmlBuffer = extractZipEntry(buffer, documentEntry, resolvedPolicy.maxBytesPerFile);
  if (!xmlBuffer) {
    return buildFailedResult('extract_failed', ['word/document.xml unreadable'], { sourceType: 'docx', policy });
  }
  if (xmlBuffer.length !== documentEntry.uncompressedSize) throw new Error('DOCX document expanded extent differs from its directory.');
  const remaining = () => {
    throwIfAborted(signal);
    const timeoutMs = resolvedPolicy.extractTimeoutMs - (performance.now() - startedAt);
    if (timeoutMs <= 0) throw Object.assign(new Error('DOCX XML acquisition timed out.'), { code: 'EXTRACT_TIMEOUT' });
    return { maxChars: resolvedPolicy.maxBytesPerFile, timeoutMs, signal };
  };
  const stylesEntry = entries.find(entry => entry.name === 'word/styles.xml');
  let stylesXml = null;
  if (stylesEntry) {
    remaining(); const allowance = resolvedPolicy.maxBytesPerFile - xmlBuffer.length;
    if (allowance < 1) throw Object.assign(new Error('DOCX document/styles exceed the combined extraction allowance.'), { code: 'ERR_DOCX_EXPANDED_LIMIT' });
    const bytes = extractZipEntry(buffer, stylesEntry, allowance);
    if (!bytes) throw new Error('word/styles.xml unreadable');
    if (bytes.length !== stylesEntry.uncompressedSize) throw new Error('DOCX styles expanded extent differs from its directory.');
    stylesXml = decodeDocxXmlBytes(bytes);
  }
  const styles = parseDocxStyles(stylesXml, remaining());
  const paragraphs = parseDocxParagraphsFromXml(decodeDocxXmlBytes(xmlBuffer), { ...remaining(), resolveHeadingLevel: styles.resolveLevel });
  if (!paragraphs.length) return buildFailedResult('unsupported_scanned', [], { sourceType: 'docx', policy });
  return { ok: true, paragraphs, warnings: [...styles.warnings] };
};

/** Compatibility entry point for capability/admission consumers. The structural
 * product owns all searchable text/provenance; no unconsumed raw-text provider
 * task is launched, so timeout cannot leave an opaque document pass running. */
export async function loadDocxExtractorRuntime({ refresh = false } = {}) {
  const config = getDocumentExtractorTestConfig();
  if (config.testing && config.forceDocxMissing === true) return { ok: false, reason: 'missing_dependency',
    name: 'docx-xml', version: String(DOCX_STRUCTURAL_EXTRACTION_VERSION), target: 'sax', backend: null, mod: null };
  if (!cachedRuntime || refresh) cachedRuntime = { ok: true, name: 'docx-xml',
    version: String(DOCX_STRUCTURAL_EXTRACTION_VERSION), target: 'sax', backend: 'docx-xml', mod: null };
  return cachedRuntime;
}

export async function extractDocx({
  filePath = null,
  buffer = null,
  policy = null,
  signal = null
} = {}) {
  throwIfAborted(signal);
  const resolvedPolicy = normalizeDocumentExtractionPolicy(policy);
  const testConfig = getDocumentExtractorTestConfig();
  const stubExtract = testConfig.testing && testConfig.stubDocxExtract === true;
  let source = Buffer.isBuffer(buffer) ? buffer : null;
  if (!source && filePath) {
    const file = path.resolve(filePath);
    try { source = (await readVerifiedContainedFile(path.dirname(file), file, { maxBytes: resolvedPolicy.maxBytesPerFile, signal })).buffer; }
    catch (error) {
      const failure = describeStorageFailure(error, { phase: 'docx-source-admission' });
      if (failure.code !== 'ERR_FILE_TOO_LARGE') throw error;
      return buildFailedResult('oversize', [], { sourceType: 'docx', policy: resolvedPolicy });
    }
  }
  if (!source) {
    return buildFailedResult('extract_failed', ['Missing file buffer'], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
  if (source.length > resolvedPolicy.maxBytesPerFile) {
    return buildFailedResult('oversize', [], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
  if (stubExtract) {
    const text = normalizeExtractedText(source.toString('utf8'));
    if (!text) {
      return buildFailedResult('unsupported_scanned', [], {
        sourceType: 'docx',
        policy: resolvedPolicy
      });
    }
    return {
      ok: true,
      paragraphs: [{ index: 1, text }],
      warnings: [],
      fidelity: buildDocumentExtractionFidelity({
        sourceType: 'docx',
        status: 'ok',
        warnings: [],
        policy: resolvedPolicy
      }),
      extractor: {
        name: 'docx-test-stub',
        version: 'test',
        target: 'stub'
      }
    };
  }
  if (isEncryptedDocxBuffer(source)) {
    return buildFailedResult('unsupported_encrypted', [], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
  const runtime = await loadDocxExtractorRuntime();
  if (!runtime.ok) {
    return buildFailedResult('missing_dependency', [], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
  try {
    const parsed = parseDocxParagraphsFromBuffer(source, resolvedPolicy, signal);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      paragraphs: parsed.paragraphs,
      warnings: normalizeWarnings(parsed.warnings),
      fidelity: buildDocumentExtractionFidelity({
        sourceType: 'docx',
        status: 'ok',
        warnings: parsed.warnings,
        policy: resolvedPolicy
      }),
      extractor: {
        name: runtime.name,
        version: runtime.version,
        target: runtime.target
      }
    };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) { throwIfAborted(signal); throw err; }
    return buildFailedResult(resolveDocxFailureReason(err), [err?.message], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
}
