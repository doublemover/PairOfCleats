import fs from 'node:fs/promises';
import { throwIfAborted } from '../../shared/abort.js';
import { createPdfExtractionLifetime, isPendingPdfExtractionFailure } from './pdf-lifetime.js';
import path from 'node:path';
import { createRequire } from 'node:module';
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

const require = createRequire(import.meta.url);

const PDF_IMPORT_CANDIDATES = [
  'pdfjs-dist/legacy/build/pdf.js',
  'pdfjs-dist/legacy/build/pdf.mjs',
  'pdfjs-dist/build/pdf.js',
  'pdfjs-dist'
];

const PASSWORD_HINT = /password|encrypt/i;

let cachedRuntime = null;
let cachedStandardFontDataUrl = undefined;

const normalizeItemText = (value) => normalizeExtractedText(value);

export const normalizePageText = (items) => {
  let text = '';
  for (const item of items || []) {
    const value = normalizeItemText(item?.str ?? '');
    if (value) {
      if (text && !text.endsWith('\n')) text += ' ';
      text += value;
    }
    // PDF.js hasEOL belongs AFTER this item, including empty EOL markers.
    if (item?.hasEOL) text += '\n';
  }
  return normalizeExtractedText(text);
};

const resolvePdfFailureReason = (err) => {
  const code = String(err?.code || '');
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  if (code === 'EXTRACT_TIMEOUT') return 'extract_timeout';
  if (code === 'ERR_PDF_PAGE_LIMIT') return 'oversize';
  if (name === 'PasswordException' || PASSWORD_HINT.test(message)) return 'unsupported_encrypted';
  return 'extract_failed';
};

const resolveStandardFontDataUrl = () => {
  if (cachedStandardFontDataUrl !== undefined) return cachedStandardFontDataUrl;
  try {
    const packageJsonPath = require.resolve('pdfjs-dist/package.json');
    const standardFontsDir = path.join(path.dirname(packageJsonPath), 'standard_fonts');
    const standardFontsPath = standardFontsDir.replace(/\\/g, '/');
    cachedStandardFontDataUrl = standardFontsPath.endsWith('/')
      ? standardFontsPath
      : `${standardFontsPath}/`;
  } catch {
    cachedStandardFontDataUrl = null;
  }
  return cachedStandardFontDataUrl;
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


/** Own pdf.js loading, page work and disposal across every extraction outcome. */
export const readPdfPages = async ({ pdfjs, source, policy, standardFontDataUrl = null }) => {
  let primaryError = null;
  const lifetime = createPdfExtractionLifetime();
  try {
    return await withTimeout(async signal => {
      try {
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(source), isEvalSupported: false,
          useSystemFonts: false, ...(standardFontDataUrl ? { standardFontDataUrl } : {}) });
        lifetime.adopt(loadingTask);
        const cancel = () => { void lifetime.dispose().catch(() => {}); };
        signal?.addEventListener('abort', cancel, { once: true });
        let doc;
        try { doc = await loadingTask.promise; }
        finally { signal?.removeEventListener('abort', cancel); }
        lifetime.adopt(doc, { required: false });
        throwIfAborted(signal);
        const numPages = Number(doc?.numPages) || 0;
        if (numPages > policy.maxPages) throw Object.assign(new Error('PDF page count exceeds extraction policy.'), { code: 'ERR_PDF_PAGE_LIMIT' });
        const pages = [];
        for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
          throwIfAborted(signal);
          const page = await doc.getPage(pageNumber);
          let pageError = null;
          try {
            throwIfAborted(signal);
            const content = await page.getTextContent();
            throwIfAborted(signal);
            pages.push({ pageNumber, text: normalizePageText(content?.items || []) });
          } catch (value) {
            pageError = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
            lifetime.observe(pageError); throw pageError;
          } finally {
            try { await page.cleanup?.(); }
            catch (value) {
              const cleanupError = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
              lifetime.observe(cleanupError);
              throw lifetime.retain(pageError, [cleanupError]);
            }
          }
        }
        return pages;
      } catch (error) { lifetime.observe(error); throw error; }
      finally { lifetime.finishOperation(); }
    }, policy.extractTimeoutMs);
  } catch (value) {
    primaryError = value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
    lifetime.observe(primaryError); throw primaryError;
  }
  finally {
    const cleanupErrors = await lifetime.dispose();
    if (cleanupErrors.length || !lifetime.isSettled()) throw lifetime.retain(primaryError, cleanupErrors);
  }
};

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
    return buildFailedResult('extract_failed', ['Missing file buffer'], {
      sourceType: 'pdf',
      policy: resolvedPolicy
    });
  }
  if (source.length > resolvedPolicy.maxBytesPerFile) {
    return buildFailedResult('oversize', [], {
      sourceType: 'pdf',
      policy: resolvedPolicy
    });
  }
  if (stubExtract) {
    try {
      return await withTimeout(async () => {
        if (stubDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, stubDelayMs));
        }
        const text = normalizeExtractedText(source.toString('utf8'));
        if (!text) {
          return buildFailedResult('unsupported_scanned', [], {
            sourceType: 'pdf',
            policy: resolvedPolicy
          });
        }
        return {
          ok: true,
          pages: [{ pageNumber: 1, text }],
          warnings: [],
          fidelity: buildDocumentExtractionFidelity({
            sourceType: 'pdf',
            status: 'ok',
            warnings: [],
            policy: resolvedPolicy
          }),
          extractor: {
            name: 'pdf-test-stub',
            version: 'test',
            target: 'stub'
          }
        };
      }, resolvedPolicy.extractTimeoutMs);
    } catch (err) {
      return buildFailedResult(resolvePdfFailureReason(err), [err?.message], {
        sourceType: 'pdf',
        policy: resolvedPolicy
      });
    }
  }
  const runtime = await loadPdfExtractorRuntime();
  if (!runtime.ok || !runtime.mod) {
    return buildFailedResult('missing_dependency', [], {
      sourceType: 'pdf',
      policy: resolvedPolicy
    });
  }
  try {
    const result = await readPdfPages({ pdfjs: runtime.mod, source, policy: resolvedPolicy,
      standardFontDataUrl: resolveStandardFontDataUrl() });
    const pages = result;
    const nonEmptyPageCount = pages.reduce((count, page) => count + (page.text ? 1 : 0), 0);
    if (!pages.length || nonEmptyPageCount === 0) {
      return buildFailedResult('unsupported_scanned', [], {
        sourceType: 'pdf',
        policy: resolvedPolicy
      });
    }
    return {
      ok: true,
      pages,
      warnings: normalizeWarnings(warnings),
      fidelity: buildDocumentExtractionFidelity({
        sourceType: 'pdf',
        status: 'ok',
        warnings,
        policy: resolvedPolicy
      }),
      extractor: {
        name: runtime.name,
        version: runtime.version,
        target: runtime.target
      }
    };
  } catch (err) {
    if (isPendingPdfExtractionFailure(err)) throw err;
    return buildFailedResult(resolvePdfFailureReason(err), [err?.message], {
      sourceType: 'pdf',
      policy: resolvedPolicy
    });
  }
}
