import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { tryImport } from '../../shared/optional-deps.js';
import { getDocumentExtractorTestConfig } from '../../shared/env.js';
import {
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

const decodeXmlEntities = (value) => (
  String(value || '').replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|#39);/g,
    (_, token) => {
      switch (token) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case '#39':
          return '\'';
        default:
          break;
      }
      if (token.startsWith('#x')) {
        const code = Number.parseInt(token.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
      }
      if (token.startsWith('#')) {
        const code = Number.parseInt(token.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
      }
      return '';
    }
  )
);

const resolveDocxFailureReason = (err) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();
  if (code === 'EXTRACT_TIMEOUT') return 'extract_timeout';
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
      localHeaderOffset
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
};

const extractZipEntry = (buffer, entry) => {
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;
  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length || dataEnd <= dataStart) return null;
  const payload = buffer.slice(dataStart, dataEnd);
  if (entry.compressionMethod === 0) return payload;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(payload);
  return null;
};

const parseDocxParagraphsFromXml = (xml) => {
  const paragraphs = [];
  const paragraphMatches = xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g);
  let index = 0;
  for (const match of paragraphMatches) {
    const paragraphXml = match[0] || '';
    const styleMatch = paragraphXml.match(/<w:pStyle\b[^>]*w:val=(?:"([^"]+)"|'([^']+)')/i);
    const style = styleMatch ? (styleMatch[1] || styleMatch[2] || null) : null;
    const normalized = paragraphXml
      .replace(/<w:tab\s*\/>/gi, '\t')
      .replace(/<w:br\s*\/>/gi, '\n')
      .replace(/<w:cr\s*\/>/gi, '\n');
    const textRuns = [];
    for (const textMatch of normalized.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)) {
      textRuns.push(decodeXmlEntities(textMatch[1]));
    }
    const text = normalizeExtractedText(textRuns.join(''));
    index += 1;
    if (!text) continue;
    paragraphs.push({
      index,
      text,
      ...(style ? { style } : {})
    });
  }
  return paragraphs;
};

const parseDocxParagraphsFromBuffer = (buffer) => {
  const entries = parseCentralDirectory(buffer);
  if (hasEncryptedDocxEntries(entries)) {
    return buildFailedResult('unsupported_encrypted');
  }
  const documentEntry = entries.find((entry) => entry.name === 'word/document.xml');
  if (!documentEntry) return buildFailedResult('extract_failed', ['word/document.xml missing']);
  const xmlBuffer = extractZipEntry(buffer, documentEntry);
  if (!xmlBuffer) return buildFailedResult('extract_failed', ['word/document.xml unreadable']);
  const xml = xmlBuffer.toString('utf8');
  const paragraphs = parseDocxParagraphsFromXml(xml);
  if (!paragraphs.length) return buildFailedResult('unsupported_scanned');
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

const extractWithMammoth = async (runtime, source) => {
  const result = await runtime.mod.extractRawText({ buffer: source });
  const warnings = normalizeWarnings(result?.messages);
  const lines = String(result?.value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const paragraphs = [];
  for (const rawLine of lines) {
    const text = normalizeExtractedText(rawLine);
    if (!text) continue;
    paragraphs.push({ index: paragraphs.length + 1, text });
  }
  if (!paragraphs.length) return buildFailedResult('unsupported_scanned', warnings);
  return { ok: true, paragraphs, warnings };
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
  if (!source) return buildFailedResult('extract_failed', ['Missing file buffer']);
  if (source.length > resolvedPolicy.maxBytesPerFile) {
    return buildFailedResult('oversize');
  }
  if (stubExtract) {
    const text = normalizeExtractedText(source.toString('utf8'));
    if (!text) return buildFailedResult('unsupported_scanned');
    return {
      ok: true,
      paragraphs: [{ index: 1, text }],
      warnings: [],
      extractor: {
        name: 'docx-test-stub',
        version: 'test',
        target: 'stub'
      }
    };
  }
  if (isEncryptedDocxBuffer(source)) {
    return buildFailedResult('unsupported_encrypted');
  }
  const runtime = await loadDocxExtractorRuntime();
  if (!runtime.ok) return buildFailedResult('missing_dependency');
  try {
    const parsed = await withTimeout(async () => {
      if (runtime.backend === 'mammoth') {
        return extractWithMammoth(runtime, source);
      }
      return parseDocxParagraphsFromBuffer(source);
    }, resolvedPolicy.extractTimeoutMs);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      paragraphs: parsed.paragraphs,
      warnings: normalizeWarnings(parsed.warnings),
      extractor: {
        name: runtime.name,
        version: runtime.version,
        target: runtime.target
      }
    };
  } catch (err) {
    return buildFailedResult(resolveDocxFailureReason(err), [err?.message]);
  }
}
