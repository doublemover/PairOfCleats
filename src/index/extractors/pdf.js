import fs from 'node:fs/promises';
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

const PDF_IMPORT_CANDIDATES = [
  'pdfjs-dist/legacy/build/pdf.js',
  'pdfjs-dist/legacy/build/pdf.mjs',
  'pdfjs-dist/build/pdf.js',
  'pdfjs-dist'
];

const PASSWORD_HINT = /password|encrypt/i;

let cachedRuntime = null;

const normalizeItemText = (value) => normalizeExtractedText(value);

const normalizePageText = (items) => {
  let text = '';
  for (const item of items || []) {
    const raw = item?.str;
    if (!raw) continue;
    const value = normalizeItemText(raw);
    if (!value) continue;
    if (!text) {
      text = value;
      continue;
    }
    text += item?.hasEOL ? `\n${value}` : ` ${value}`;
  }
  return normalizeExtractedText(text);
};

const resolvePdfFailureReason = (err) => {
  const code = String(err?.code || '');
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  if (code === 'EXTRACT_TIMEOUT') return 'extract_timeout';
  if (name === 'PasswordException' || PASSWORD_HINT.test(message)) return 'unsupported_encrypted';
  return 'extract_failed';
};

export async function loadPdfExtractorRuntime({ refresh = false } = {}) {
  const testConfig = getDocumentExtractorTestConfig();
  const forceMissing = testConfig.testing && testConfig.forcePdfMissing === true;
  if (forceMissing) {
    cachedRuntime = {
      ok: false,
      reason: 'missing_dependency',
      name: 'pdfjs-dist',
      version: null,
      target: null,
      mod: null
    };
    return cachedRuntime;
  }
  if (cachedRuntime && !refresh) return cachedRuntime;
  for (const target of PDF_IMPORT_CANDIDATES) {
    const imported = await tryImport(target);
    if (!imported.ok || !imported.mod) continue;
    const mod = imported.mod.default || imported.mod;
    if (typeof mod?.getDocument !== 'function') continue;
    cachedRuntime = {
      ok: true,
      name: 'pdfjs-dist',
      version: resolvePackageVersion('pdfjs-dist'),
      target,
      mod
    };
    return cachedRuntime;
  }
  cachedRuntime = {
    ok: false,
    reason: 'missing_dependency',
    name: 'pdfjs-dist',
    version: resolvePackageVersion('pdfjs-dist'),
    target: null,
    mod: null
  };
  return cachedRuntime;
}

export async function extractPdf({
  filePath = null,
  buffer = null,
  policy = null
} = {}) {
  const resolvedPolicy = normalizeDocumentExtractionPolicy(policy);
  const testConfig = getDocumentExtractorTestConfig();
  const stubExtract = testConfig.testing && testConfig.stubPdfExtract === true;
  const stubDelayMs = testConfig.testing ? testConfig.stubPdfExtractDelayMs : 0;
  const warnings = [];
  const source = Buffer.isBuffer(buffer)
    ? buffer
    : (filePath ? await fs.readFile(filePath) : null);
  if (!source) {
    return buildFailedResult('extract_failed', ['Missing file buffer']);
  }
  if (source.length > resolvedPolicy.maxBytesPerFile) {
    return buildFailedResult('oversize');
  }
  if (stubExtract) {
    try {
      return await withTimeout(async () => {
        if (stubDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, stubDelayMs));
        }
        const text = normalizeExtractedText(source.toString('utf8'));
        if (!text) return buildFailedResult('unsupported_scanned');
        return {
          ok: true,
          pages: [{ pageNumber: 1, text }],
          warnings: [],
          extractor: {
            name: 'pdf-test-stub',
            version: 'test',
            target: 'stub'
          }
        };
      }, resolvedPolicy.extractTimeoutMs);
    } catch (err) {
      return buildFailedResult(resolvePdfFailureReason(err), [err?.message]);
    }
  }
  const runtime = await loadPdfExtractorRuntime();
  if (!runtime.ok || !runtime.mod) {
    return buildFailedResult('missing_dependency');
  }
  try {
    const result = await withTimeout(async () => {
      const pdfjs = runtime.mod;
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(source),
        isEvalSupported: false,
        useSystemFonts: false
      });
      const doc = await loadingTask.promise;
      const numPages = Number(doc?.numPages) || 0;
      if (numPages > resolvedPolicy.maxPages) {
        if (typeof doc?.destroy === 'function') await doc.destroy();
        if (typeof loadingTask?.destroy === 'function') await loadingTask.destroy();
        return buildFailedResult('oversize');
      }
      const pages = [];
      for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = normalizePageText(content?.items || []);
        pages.push({ pageNumber, text });
      }
      if (typeof doc?.destroy === 'function') await doc.destroy();
      if (typeof loadingTask?.destroy === 'function') await loadingTask.destroy();
      const nonEmptyPageCount = pages.reduce((count, page) => count + (page.text ? 1 : 0), 0);
      if (!pages.length || nonEmptyPageCount === 0) {
        return buildFailedResult('unsupported_scanned');
      }
      return {
        ok: true,
        pages,
        warnings: normalizeWarnings(warnings),
        extractor: {
          name: runtime.name,
          version: runtime.version,
          target: runtime.target
        }
      };
    }, resolvedPolicy.extractTimeoutMs);
    return result;
  } catch (err) {
    return buildFailedResult(resolvePdfFailureReason(err), [err?.message]);
  }
}
