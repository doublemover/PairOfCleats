import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import sax from 'sax';
import { tryImport } from '../../shared/optional-deps.js';
import { getDocumentExtractorTestConfig } from '../../shared/env/testing.js';
import {
  buildDocumentExtractionFidelity,
  buildFailedResult,
  normalizeDocumentExtractionPolicy,
  normalizeExtractedText,
  normalizeWarnings,
  resolvePackageVersion,
  withTimeout
} from './common.js';

const DOCX_IMPORT_CANDIDATES = [
  { target: 'mammoth', backend: 'mammoth' },
  { target: 'docx', backend: 'docx' }
];

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

let cachedRuntime = null;

const WORD_NS = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main'
]);

const resolveDocxFailureReason = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();
  if (code === 'EXTRACT_TIMEOUT') return 'extract_timeout';
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_DOCX_EXPANDED_LIMIT') return 'oversize';
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
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
};

const parseCentralDirectory = (buffer) => {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error('DOCX zip central directory not found');
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = centralOffset;
  const entries = [];
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buffer.length) break;
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = buffer.slice(nameStart, nameEnd).toString('utf8');
    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    cursor = nameEnd + extraLength + commentLength;
  }
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
  const payload = buffer.slice(dataStart, dataEnd);
  if (entry.compressionMethod === 0) {
    if (payload.length > maxOutputBytes) throw oversize();
    return payload;
  }
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(payload, { maxOutputLength: maxOutputBytes });
  return null;
};

export const parseDocxParagraphsFromXml = (xml) => {
  const paragraphs = [];
  const parser = sax.parser(true, { xmlns: true });
  const stack = [];
  const excludedRanges = new Set();
  let paragraph = null;
  let index = 0;
  const isWord = (node, local) => WORD_NS.has(node?.uri) && node.local === local;
  const wordAttribute = (node, local) => Object.values(node.attributes).find(
    (attribute) => WORD_NS.has(attribute.uri) && attribute.local === local
  )?.value;
  const canRead = () => paragraph && !stack.at(-1)?.excluded && excludedRanges.size === 0;
  parser.ondoctype = () => { throw new Error('DOCX document XML must not contain a DTD.'); };
  parser.onopentag = (node) => {
    const excluded = Boolean(stack.at(-1)?.excluded)
      || isWord(node, 'del') || isWord(node, 'moveFrom');
    stack.push({ node, excluded });
    if (isWord(node, 'moveFromRangeStart')) {
      const id = wordAttribute(node, 'id');
      if (!id || excludedRanges.has(id)) throw new Error('Invalid DOCX moved-from range start.');
      excludedRanges.add(id);
    } else if (isWord(node, 'moveFromRangeEnd')) {
      const id = wordAttribute(node, 'id');
      if (!id || !excludedRanges.delete(id)) throw new Error('Invalid DOCX moved-from range end.');
    }
    if (excluded) return;
    if (isWord(node, 'p') && excludedRanges.size === 0) {
      if (paragraph) throw new Error('Nested DOCX paragraphs cannot be ordered.');
      paragraph = { index: ++index, runs: [], style: null };
    } else if (isWord(node, 'pStyle') && paragraph) {
      paragraph.style = wordAttribute(node, 'val') || null;
    } else if (canRead() && (isWord(node, 'tab') || isWord(node, 'br') || isWord(node, 'cr'))) {
      paragraph.runs.push(isWord(node, 'tab') ? '\t' : '\n');
    }
  };
  parser.ontext = (value) => {
    if (canRead() && isWord(stack.at(-1)?.node, 't')) paragraph.runs.push(value);
  };
  parser.oncdata = parser.ontext;
  parser.onclosetag = () => {
    const { node, excluded } = stack.pop();
    if (isWord(node, 'p') && !excluded && paragraph) {
      const text = normalizeExtractedText(paragraph.runs.join(''));
      if (text) paragraphs.push({
        index: paragraph.index,
        text,
        ...(paragraph.style ? { style: paragraph.style } : {})
      });
      paragraph = null;
    }
  };
  parser.write(xml).close();
  if (excludedRanges.size) throw new Error('Unclosed DOCX moved-from range.');
  return paragraphs;
};

const parseDocxParagraphsFromBuffer = (buffer, policy = null) => {
  const entries = parseCentralDirectory(buffer);
  if (hasEncryptedDocxEntries(entries)) {
    return buildFailedResult('unsupported_encrypted', [], { sourceType: 'docx', policy });
  }
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) {
    return buildFailedResult('extract_failed', ['word/document.xml missing'], { sourceType: 'docx', policy });
  }
  const xmlBuffer = extractZipEntry(buffer, documentEntry, normalizeDocumentExtractionPolicy(policy).maxBytesPerFile);
  if (!xmlBuffer) {
    return buildFailedResult('extract_failed', ['word/document.xml unreadable'], { sourceType: 'docx', policy });
  }
  const xml = xmlBuffer.toString('utf8');
  const paragraphs = parseDocxParagraphsFromXml(xml);
  if (!paragraphs.length) return buildFailedResult('unsupported_scanned', [], { sourceType: 'docx', policy });
  return { ok: true, paragraphs, warnings: [] };
};

export async function loadDocxExtractorRuntime({ refresh = false } = {}) {
  const testConfig = getDocumentExtractorTestConfig();
  const forceMissing = testConfig.testing && testConfig.forceDocxMissing === true;
  if (forceMissing) {
    cachedRuntime = {
      ok: false,
      reason: 'missing_dependency',
      name: 'mammoth',
      version: null,
      target: null,
      backend: null,
      mod: null
    };
    return cachedRuntime;
  }
  if (cachedRuntime && !refresh) return cachedRuntime;
  for (const candidate of DOCX_IMPORT_CANDIDATES) {
    const imported = await tryImport(candidate.target);
    if (!imported.ok || !imported.mod) continue;
    const mod = imported.mod.default || imported.mod;
    if (candidate.backend === 'mammoth' && typeof mod?.extractRawText !== 'function') continue;
    cachedRuntime = {
      ok: true,
      name: candidate.backend === 'mammoth' ? 'mammoth' : 'docx',
      version: resolvePackageVersion(candidate.target),
      target: candidate.target,
      backend: candidate.backend,
      mod
    };
    return cachedRuntime;
  }
  cachedRuntime = {
    ok: false,
    reason: 'missing_dependency',
    name: 'mammoth',
    version: resolvePackageVersion('mammoth'),
    target: null,
    backend: null,
    mod: null
  };
  return cachedRuntime;
}

const extractWithMammoth = async (runtime, source, policy) => {
  const extracted = await runtime.mod.extractRawText({ buffer: source });
  const warnings = normalizeWarnings(extracted?.messages);
  // Raw Mammoth lines are display output, not Word paragraph identities. The
  // bounded structural owner supplies physical ordinals and paragraph styles
  // for both backends, including omitted empty paragraphs and table paragraphs.
  const structural = parseDocxParagraphsFromBuffer(source, policy);
  return { ...structural, warnings: normalizeWarnings([...(structural.warnings || []), ...warnings]) };
};

export async function extractDocx({
  filePath = null,
  buffer = null,
  policy = null
} = {}) {
  const resolvedPolicy = normalizeDocumentExtractionPolicy(policy);
  const testConfig = getDocumentExtractorTestConfig();
  const stubExtract = testConfig.testing && testConfig.stubDocxExtract === true;
  const source = Buffer.isBuffer(buffer)
    ? buffer
    : (filePath ? await fs.readFile(filePath) : null);
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
    const parsed = await withTimeout(async () => {
      if (runtime.backend === 'mammoth') {
        return extractWithMammoth(runtime, source, resolvedPolicy);
      }
      return parseDocxParagraphsFromBuffer(source, resolvedPolicy);
    }, resolvedPolicy.extractTimeoutMs);
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
    return buildFailedResult(resolveDocxFailureReason(err), [err?.message], {
      sourceType: 'docx',
      policy: resolvedPolicy
    });
  }
}
