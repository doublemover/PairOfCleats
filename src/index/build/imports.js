import path from 'node:path';
import { init as initEsModuleLexer, parse as parseEsModuleLexer } from 'es-module-lexer';
import { init as initCjsLexer, parse as parseCjsLexer } from 'cjs-module-lexer';
import { collectLanguageImports } from '../language-registry.js';
import { isJsLike, isTypeScript } from '../constants.js';
import { normalizeImportSpecifiers, sanitizeImportSpecifier } from '../shared/import-specifier.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { coerceAbortSignal, throwIfAborted } from '../../shared/abort.js';
import { readTextFile, readTextFileWithHash } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';
import { readCachedImports } from './incremental.js';
import {
  IMPORT_DISPOSITIONS,
  IMPORT_REASON_CODES,
  IMPORT_RESOLUTION_STATES,
  resolveDecisionFromReasonCode
} from './import-resolution/reason-codes.js';

let esModuleInitPromise = null;
let cjsInitPromise = null;

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

export const UNRESOLVED_IMPORT_CATEGORIES = Object.freeze({
  FIXTURE: 'fixture',
  OPTIONAL_DEPENDENCY: 'optional_dependency',
  TYPO: 'typo',
  PATH_NORMALIZATION: 'path_normalization',
  PARSER_ARTIFACT: 'parser_artifact',
  RESOLVER_GAP: 'resolver_gap',
  GENERATED_EXPECTED_MISSING: 'generated_expected_missing',
  MISSING_FILE: 'missing_file',
  MISSING_DEPENDENCY: 'missing_dependency',
  PARSE_ERROR: 'parse_error',
  UNKNOWN: 'unknown'
});

const FIXTURE_HINT_SEGMENTS = [
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/test/',
  '/tests/',
  '/__tests__/',
  '/spec/',
  '/specs/',
  '/expected_output/',
  '/golden/',
  '/mocks/',
  '/mock/'
];
const OPTIONAL_DEPENDENCY_PACKAGE_HINTS = new Set([
  'bufferutil',
  'canvas',
  'fsevents',
  'pg-native',
  'sharp',
  'supports-color',
  'utf-8-validate'
]);
const TYPO_EXTENSION_HINTS = [
  '.csx',
  '.goo',
  '.jav',
  '.jss',
  '.jsxs',
  '.jsxx',
  '.ktt',
  '.pyy',
  '.swfit',
  '.tss',
  '.tsxx'
];
const TYPO_TOKEN_HINTS = [
  'confg',
  'funciton',
  'resposne',
  'teh',
  'utlis'
];

const normalizeForClassifier = (value) => (
  typeof value === 'string' ? value.trim().replace(/\\/g, '/') : ''
);

const normalizeLowerForClassifier = (value) => normalizeForClassifier(value).toLowerCase();

const extractPackageRoot = (specifier) => {
  const normalized = normalizeForClassifier(specifier);
  if (!normalized) return '';
  if (normalized.startsWith('@')) {
    const segments = normalized.split('/');
    if (segments.length >= 2) return `${segments[0]}/${segments[1]}`;
    return normalized;
  }
  const slash = normalized.indexOf('/');
  return slash === -1 ? normalized : normalized.slice(0, slash);
};

const hasFixtureHint = ({ importer, specifier }) => {
  const importerLower = normalizeLowerForClassifier(importer);
  const specLower = normalizeLowerForClassifier(specifier);
  return FIXTURE_HINT_SEGMENTS.some((segment) => importerLower.includes(segment) || specLower.includes(segment));
};

const hasOptionalDependencyHint = ({ importer, specifier, reason }) => {
  const reasonLower = normalizeLowerForClassifier(reason);
  if (reasonLower.includes('optional')) return true;
  const specNormalized = normalizeForClassifier(specifier);
  if (!specNormalized) return false;
  const specLower = specNormalized.toLowerCase();
  if (specLower.includes('?optional') || specLower.includes('#optional')) return true;
  const importerLower = normalizeLowerForClassifier(importer);
  if (importerLower.includes('/optional/')) return true;
  const packageRoot = extractPackageRoot(specNormalized).toLowerCase();
  return OPTIONAL_DEPENDENCY_PACKAGE_HINTS.has(packageRoot);
};

const hasPathNormalizationHint = (specifier) => {
  const raw = typeof specifier === 'string' ? specifier : '';
  const normalized = normalizeForClassifier(specifier);
  if (!normalized) return false;
  const looksLikeBazelLabel = normalized.startsWith('//')
    && !/^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/.test(normalized)
    && /^\/\/[A-Za-z0-9_@.+~/-]*(?::[A-Za-z0-9_@.+~/-]+)?$/.test(normalized);
  if (looksLikeBazelLabel) return false;
  if (/[A-Za-z]:[\\/]/.test(raw)) return true;
  if (raw.includes('\\')) return true;
  if (normalized.includes('/./') || normalized.endsWith('/.') || normalized.includes('/../')) return true;
  if (/(^|[^:])\/\/+/.test(normalized)) return true;
  if (/%2f|%5c/i.test(normalized)) return true;
  return false;
};

const hasTypoHint = (specifier) => {
  const normalized = normalizeForClassifier(specifier);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (/\s/.test(normalized)) return true;
  if (TYPO_EXTENSION_HINTS.some((hint) => lower.endsWith(hint))) return true;
  const stem = lower.split('/').pop() || '';
  return TYPO_TOKEN_HINTS.some((hint) => stem.includes(hint));
};

const toSortedCategoryCounts = (counts) => {
  const entries = counts instanceof Map
    ? Array.from(counts.entries())
    : Object.entries(counts || {});
  entries.sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [category, count] of entries) {
    if (!category) continue;
    const numeric = Number(count);
    output[category] = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }
  return output;
};

const toSortedCountObject = (counts) => {
  const entries = counts instanceof Map
    ? Array.from(counts.entries())
    : Object.entries(counts || {});
  entries.sort((a, b) => sortStrings(a[0], b[0]));
  const output = Object.create(null);
  for (const [key, count] of entries) {
    if (!key) continue;
    const numeric = Number(count);
    output[key] = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }
  return output;
};

const classifyCategory = ({ importer, specifier, reason }) => {
  const normalizedSpecifier = normalizeForClassifier(specifier);
  const normalizedReason = normalizeForClassifier(reason);
  const isRelative = normalizedSpecifier.startsWith('.')
    || normalizedSpecifier.startsWith('/')
    || normalizedSpecifier.startsWith('\\');
  if (normalizedReason.toLowerCase().includes('parse')) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.PARSE_ERROR,
      confidence: 0.95,
      suggestedRemediation: 'Fix parse errors in the importer before resolving imports.'
    };
  }
  if (hasFixtureHint({ importer, specifier: normalizedSpecifier })) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.FIXTURE,
      confidence: 0.9,
      suggestedRemediation: 'Keep fixture-only unresolved imports suppressed or map fixture roots explicitly.'
    };
  }
  if (hasOptionalDependencyHint({ importer, specifier: normalizedSpecifier, reason: normalizedReason })) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.OPTIONAL_DEPENDENCY,
      confidence: 0.87,
      suggestedRemediation: 'Document optional dependency behavior or install the dependency for full resolution.'
    };
  }
  if (hasPathNormalizationHint(specifier)) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.PATH_NORMALIZATION,
      confidence: 0.83,
      suggestedRemediation: 'Normalize path separators and collapse redundant path segments in the import specifier.'
    };
  }
  if (hasTypoHint(normalizedSpecifier)) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.TYPO,
      confidence: 0.75,
      suggestedRemediation: 'Check for spelling mistakes in the import path or module name.'
    };
  }
  if (isRelative) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.MISSING_FILE,
      confidence: 0.68,
      suggestedRemediation: 'Verify the target file exists and that relative pathing matches repository layout.'
    };
  }
  if (normalizedSpecifier) {
    return {
      category: UNRESOLVED_IMPORT_CATEGORIES.MISSING_DEPENDENCY,
      confidence: 0.72,
      suggestedRemediation: 'Install or map the dependency path so import resolution can locate it.'
    };
  }
  return {
    category: UNRESOLVED_IMPORT_CATEGORIES.UNKNOWN,
    confidence: 0.5,
    suggestedRemediation: 'Inspect import parser output for malformed or empty unresolved specifiers.'
  };
};

const mapReasonCodeToCategory = (reasonCode) => {
  switch (reasonCode) {
    case IMPORT_REASON_CODES.PARSE_ERROR:
      return UNRESOLVED_IMPORT_CATEGORIES.PARSE_ERROR;
    case IMPORT_REASON_CODES.FIXTURE_REFERENCE:
      return UNRESOLVED_IMPORT_CATEGORIES.FIXTURE;
    case IMPORT_REASON_CODES.OPTIONAL_DEPENDENCY:
      return UNRESOLVED_IMPORT_CATEGORIES.OPTIONAL_DEPENDENCY;
    case IMPORT_REASON_CODES.PARSER_NOISE_SUPPRESSED:
      return UNRESOLVED_IMPORT_CATEGORIES.PARSER_ARTIFACT;
    case IMPORT_REASON_CODES.PATH_NORMALIZATION:
      return UNRESOLVED_IMPORT_CATEGORIES.PATH_NORMALIZATION;
    case IMPORT_REASON_CODES.TYPO:
      return UNRESOLVED_IMPORT_CATEGORIES.TYPO;
    case IMPORT_REASON_CODES.MISSING_FILE_RELATIVE:
      return UNRESOLVED_IMPORT_CATEGORIES.MISSING_FILE;
    case IMPORT_REASON_CODES.MISSING_DEPENDENCY_PACKAGE:
      return UNRESOLVED_IMPORT_CATEGORIES.MISSING_DEPENDENCY;
    case IMPORT_REASON_CODES.RESOLVER_GAP:
      return UNRESOLVED_IMPORT_CATEGORIES.RESOLVER_GAP;
    default:
      return UNRESOLVED_IMPORT_CATEGORIES.UNKNOWN;
  }
};

const mapCategoryToReasonCode = (category) => {
  switch (category) {
    case UNRESOLVED_IMPORT_CATEGORIES.PARSE_ERROR:
      return IMPORT_REASON_CODES.PARSE_ERROR;
    case UNRESOLVED_IMPORT_CATEGORIES.FIXTURE:
      return IMPORT_REASON_CODES.FIXTURE_REFERENCE;
    case UNRESOLVED_IMPORT_CATEGORIES.OPTIONAL_DEPENDENCY:
      return IMPORT_REASON_CODES.OPTIONAL_DEPENDENCY;
    case UNRESOLVED_IMPORT_CATEGORIES.PATH_NORMALIZATION:
      return IMPORT_REASON_CODES.PATH_NORMALIZATION;
    case UNRESOLVED_IMPORT_CATEGORIES.TYPO:
      return IMPORT_REASON_CODES.TYPO;
    case UNRESOLVED_IMPORT_CATEGORIES.MISSING_FILE:
      return IMPORT_REASON_CODES.MISSING_FILE_RELATIVE;
    case UNRESOLVED_IMPORT_CATEGORIES.MISSING_DEPENDENCY:
      return IMPORT_REASON_CODES.MISSING_DEPENDENCY_PACKAGE;
    case UNRESOLVED_IMPORT_CATEGORIES.RESOLVER_GAP:
      return IMPORT_REASON_CODES.RESOLVER_GAP;
    case UNRESOLVED_IMPORT_CATEGORIES.PARSER_ARTIFACT:
      return IMPORT_REASON_CODES.PARSER_NOISE_SUPPRESSED;
    default:
      return IMPORT_REASON_CODES.UNKNOWN;
  }
};

const mapFailureCauseToCategory = (failureCause) => {
  switch (failureCause) {
    case 'missing_file':
      return UNRESOLVED_IMPORT_CATEGORIES.MISSING_FILE;
    case 'missing_dependency':
      return UNRESOLVED_IMPORT_CATEGORIES.MISSING_DEPENDENCY;
    case 'generated_expected_missing':
      return UNRESOLVED_IMPORT_CATEGORIES.GENERATED_EXPECTED_MISSING;
    case 'parser_artifact':
      return UNRESOLVED_IMPORT_CATEGORIES.PARSER_ARTIFACT;
    case 'resolver_gap':
      return UNRESOLVED_IMPORT_CATEGORIES.RESOLVER_GAP;
    case 'parse_error':
      return UNRESOLVED_IMPORT_CATEGORIES.PARSE_ERROR;
    default:
      return null;
  }
};

const unresolvedSortKey = (sample) => (
  [
    sample.importer || '',
    sample.specifier || '',
    sample.reason || '',
    sample.reasonCode || '',
    sample.category || ''
  ].join('|')
);

export const classifyUnresolvedImportSample = (sample) => {
  const importer = typeof sample?.importer === 'string' ? normalizeForClassifier(sample.importer) : '';
  const specifier = sanitizeImportSpecifier(sample?.specifier, { stripTrailingPunctuation: false });
  const reason = typeof sample?.reason === 'string' && sample.reason.trim()
    ? sample.reason.trim()
    : 'unresolved';
  const incomingReasonCode = typeof sample?.reasonCode === 'string' ? sample.reasonCode.trim() : '';
  const incomingFailureCause = typeof sample?.failureCause === 'string' ? sample.failureCause.trim() : '';
  const categoryFromFailureCause = mapFailureCauseToCategory(incomingFailureCause);
  const classificationFromCode = incomingReasonCode
    ? mapReasonCodeToCategory(incomingReasonCode)
    : categoryFromFailureCause;
  const classified = classificationFromCode
    ? {
      category: classificationFromCode,
      confidence: 0.95,
      suggestedRemediation: 'Review unresolved diagnostic metadata for precise cause/remediation.'
    }
    : classifyCategory({ importer, specifier, reason });
  const reasonCode = incomingReasonCode || mapCategoryToReasonCode(classified.category);
  const decision = resolveDecisionFromReasonCode(reasonCode);
  const disposition = typeof sample?.disposition === 'string' && sample.disposition.trim()
    ? sample.disposition.trim()
    : decision.disposition;
  const resolverStage = typeof sample?.resolverStage === 'string' && sample.resolverStage.trim()
    ? sample.resolverStage.trim()
    : decision.resolverStage;
  const failureCause = typeof sample?.failureCause === 'string' && sample.failureCause.trim()
    ? sample.failureCause.trim()
    : decision.failureCause;
  const resolutionState = sample?.resolutionState === IMPORT_RESOLUTION_STATES.RESOLVED
    ? IMPORT_RESOLUTION_STATES.RESOLVED
    : IMPORT_RESOLUTION_STATES.UNRESOLVED;
  const suppressLive = disposition !== IMPORT_DISPOSITIONS.ACTIONABLE;
  return {
    importer,
    specifier,
    reason,
    reasonCode,
    resolutionState,
    failureCause,
    disposition,
    resolverStage,
    category: classified.category,
    confidence: classified.confidence,
    suggestedRemediation: classified.suggestedRemediation,
    suppressLive,
    actionable: disposition === IMPORT_DISPOSITIONS.ACTIONABLE
  };
};

export const enrichUnresolvedImportSamples = (samples) => {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const deduped = new Map();
  for (const sample of samples) {
    const classified = classifyUnresolvedImportSample(sample);
    const key = `${classified.importer}|${classified.specifier}|${classified.reason}`;
    if (!deduped.has(key)) deduped.set(key, classified);
  }
  return Array.from(deduped.values()).sort((a, b) => sortStrings(unresolvedSortKey(a), unresolvedSortKey(b)));
};

export const summarizeUnresolvedImportTaxonomy = (samples) => {
  const normalized = enrichUnresolvedImportSamples(samples);
  const categoryCounts = new Map();
  const reasonCodeCounts = new Map();
  const failureCauseCounts = new Map();
  const dispositionCounts = new Map();
  const suppressedCategories = new Set();
  let liveSuppressed = 0;
  let gateSuppressed = 0;
  let actionable = 0;
  for (const sample of normalized) {
    categoryCounts.set(sample.category, (categoryCounts.get(sample.category) || 0) + 1);
    if (sample.reasonCode) {
      reasonCodeCounts.set(sample.reasonCode, (reasonCodeCounts.get(sample.reasonCode) || 0) + 1);
    }
    if (sample.failureCause) {
      failureCauseCounts.set(sample.failureCause, (failureCauseCounts.get(sample.failureCause) || 0) + 1);
    }
    if (sample.disposition) {
      dispositionCounts.set(sample.disposition, (dispositionCounts.get(sample.disposition) || 0) + 1);
    }
    if (sample.disposition === IMPORT_DISPOSITIONS.SUPPRESS_LIVE) {
      liveSuppressed += 1;
      if (sample.category) suppressedCategories.add(sample.category);
    } else if (sample.disposition === IMPORT_DISPOSITIONS.SUPPRESS_GATE) {
      gateSuppressed += 1;
    } else {
      actionable += 1;
    }
  }
  return {
    total: normalized.length,
    actionable,
    liveSuppressed,
    gateSuppressed,
    categories: toSortedCategoryCounts(categoryCounts),
    reasonCodes: toSortedCountObject(reasonCodeCounts),
    failureCauses: toSortedCountObject(failureCauseCounts),
    dispositions: toSortedCountObject(dispositionCounts),
    liveSuppressedCategories: Array.from(suppressedCategories.values()).sort(sortStrings),
    actionableRate: normalized.length > 0 ? actionable / normalized.length : 0
  };
};

const ensureEsModuleLexer = async () => {
  if (!esModuleInitPromise) {
    if (typeof initEsModuleLexer === 'function') {
      esModuleInitPromise = initEsModuleLexer();
    } else if (initEsModuleLexer && typeof initEsModuleLexer.then === 'function') {
      esModuleInitPromise = initEsModuleLexer;
    } else {
      esModuleInitPromise = Promise.resolve();
    }
  }
  await esModuleInitPromise;
};

const ensureCjsLexer = async () => {
  if (!cjsInitPromise) cjsInitPromise = initCjsLexer();
  await cjsInitPromise;
};

/**
 * Deduplicate and stable-sort import specifiers for deterministic output.
 *
 * @param {string[]} list
 * @returns {string[]}
 */
const normalizeImports = (list) => {
  return normalizeImportSpecifiers(Array.isArray(list) ? list : []);
};

/**
 * Fast-path JS/TS import discovery using ESM/CJS lexers with regex fallback.
 *
 * Returns `null` when no parser path produced any signal, allowing callers to
 * defer to slower parsing logic.
 *
 * @param {{text:string,ext:string}} input
 * @returns {Promise<string[]|null>}
 */
const collectModuleImportsFast = async ({ text, ext }) => {
  if (!isJsLike(ext) && !isTypeScript(ext)) return null;
  const imports = new Set();
  let success = false;
  try {
    await ensureEsModuleLexer();
    const [entries] = parseEsModuleLexer(text);
    if (Array.isArray(entries)) {
      success = true;
      for (const entry of entries) {
        const spec = entry?.n;
        if (typeof spec === 'string' && spec) imports.add(spec);
      }
    }
  } catch {}
  try {
    await ensureCjsLexer();
    const result = parseCjsLexer(text);
    if (result) {
      success = true;
      if (Array.isArray(result.reexports)) {
        result.reexports.forEach((imp) => {
          if (imp) imports.add(imp);
        });
      }
    }
  } catch {}
  const requireRegex = /(?:^|[^.\w$])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  for (const match of text.matchAll(requireRegex)) {
    if (match[1]) {
      imports.add(match[1]);
      success = true;
    }
  }
  return success ? normalizeImports(Array.from(imports)) : null;
};

/**
 * Prioritize import scanning toward files likely to yield more edges first.
 * Uses cached import counts when available, then file size, then stable index.
 *
 * @param {Array<{relKey:string,stat?:{size?:number},index:number}>} items
 * @param {Map<string, number>} cachedImportCounts
 */
export function sortImportScanItems(items, cachedImportCounts) {
  const haveCounts = cachedImportCounts instanceof Map && cachedImportCounts.size > 0;
  items.sort((a, b) => {
    if (haveCounts) {
      const aCount = cachedImportCounts.get(a.relKey) || 0;
      const bCount = cachedImportCounts.get(b.relKey) || 0;
      if (bCount !== aCount) return bCount - aCount;
    }
    const aSize = a.stat?.size || 0;
    const bSize = b.stat?.size || 0;
    if (bSize !== aSize) return bSize - aSize;
    return a.index - b.index;
  });
}

/**
 * Scan files for imports to build cross-link map.
 * @param {{files:Array<string|{abs:string,rel?:string,stat?:import('node:fs').Stats,ext?:string}>,root:string,mode:'code'|'prose',languageOptions:object,importConcurrency:number,queue?:object,incrementalState?:object,fileTextByFile?:Map<string,string>,readCachedImportsFn?:Function}} input
 * @returns {Promise<{importsByFile:Record<string,string[]>,durationMs:number,stats:{modules:number,edges:number,files:number,scanned:number}}>}
 */
export async function scanImports({
  files,
  root,
  mode,
  languageOptions,
  importConcurrency,
  queue = null,
  incrementalState = null,
  fileTextByFile = null,
  readCachedImportsFn = readCachedImports,
  abortSignal = null
}) {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  const importsByFile = new Map();
  const moduleSet = new Set();
  const start = Date.now();
  let processed = 0;
  let filesWithImports = 0;
  let edgeCount = 0;
  const progressMeta = { stage: 'imports', mode };
  const items = files.map((entry, index) => {
    const absPath = typeof entry === 'string' ? entry : entry.abs;
    const rel = typeof entry === 'object' && entry.rel ? entry.rel : path.relative(root, absPath);
    return {
      entry,
      absPath,
      relKey: toPosix(rel),
      stat: typeof entry === 'object' ? entry.stat : null,
      ext: typeof entry === 'object' && typeof entry.ext === 'string'
        ? entry.ext
        : fileExt(rel),
      index
    };
  });
  const runner = queue
    ? (items, worker, options) => runWithQueue(
      queue,
      items,
      worker,
      {
        ...(options || {}),
        signal: effectiveAbortSignal,
        requireSignal: true,
        signalLabel: 'build.imports.runWithQueue'
      }
    )
    : (items, worker, options) => runWithConcurrency(
      items,
      importConcurrency,
      worker,
      {
        ...(options || {}),
        signal: effectiveAbortSignal,
        requireSignal: true,
        signalLabel: 'build.imports.runWithConcurrency'
      }
    );

  const cachedImportsByFile = new Map();
  const cachedImportCounts = new Map();
  if (incrementalState?.enabled) {
    await runner(
      items,
      async (item) => {
        throwIfAborted(effectiveAbortSignal);
        if (!item.stat) return;
        const cachedImports = await readCachedImportsFn({
          enabled: true,
          absPath: item.absPath,
          relKey: item.relKey,
          fileStat: item.stat,
          manifest: incrementalState.manifest,
          bundleDir: incrementalState.bundleDir,
          bundleFormat: incrementalState.bundleFormat,
          sharedReadState: incrementalState.readHashCache || null
        });
        if (Array.isArray(cachedImports)) {
          if (cachedImports.length > 0) {
            cachedImportCounts.set(item.relKey, cachedImports.length);
          }
          cachedImportsByFile.set(item.relKey, cachedImports);
        } else {
          cachedImportsByFile.set(item.relKey, null);
        }
      },
      { collectResults: false }
    );
    sortImportScanItems(items, cachedImportCounts);
  }

  await runner(
    items,
    async (item) => {
      throwIfAborted(effectiveAbortSignal);
      const relKey = item.relKey;
      const ext = item.ext || fileExt(relKey);
      const hadPrefetch = cachedImportsByFile.has(relKey);
      const recordImports = (imports) => {
        if (!Array.isArray(imports)) return;
        if (imports.length > 0) filesWithImports += 1;
        importsByFile.set(relKey, imports);
        edgeCount += imports.length;
        for (const mod of imports) moduleSet.add(mod);
      };
      if (hadPrefetch) {
        const cachedImports = cachedImportsByFile.get(relKey);
        cachedImportsByFile.delete(relKey);
        if (Array.isArray(cachedImports)) {
          recordImports(cachedImports);
          processed += 1;
          showProgress('Imports', processed, items.length, progressMeta);
          return;
        }
      }
      if (!hadPrefetch && incrementalState?.enabled && item.stat) {
        const cachedImportsFallback = await readCachedImportsFn({
          enabled: true,
          absPath: item.absPath,
          relKey,
          fileStat: item.stat,
          manifest: incrementalState.manifest,
          bundleDir: incrementalState.bundleDir,
          bundleFormat: incrementalState.bundleFormat,
          sharedReadState: incrementalState.readHashCache || null
        });
        if (Array.isArray(cachedImportsFallback)) {
          recordImports(cachedImportsFallback);
          processed += 1;
          showProgress('Imports', processed, items.length, progressMeta);
          return;
        }
      }
      const cachedText = fileTextByFile?.get ? fileTextByFile.get(relKey) : null;
      let text = typeof cachedText === 'string'
        ? cachedText
        : (cachedText && typeof cachedText === 'object' && typeof cachedText.text === 'string'
          ? cachedText.text
          : null);
      let buffer = cachedText && typeof cachedText === 'object' && Buffer.isBuffer(cachedText.buffer)
        ? cachedText.buffer
        : null;
      let hash = cachedText && typeof cachedText === 'object' && cachedText.hash
        ? cachedText.hash
        : null;
      if (cachedText && typeof cachedText === 'object' && item.stat) {
        if (Number.isFinite(cachedText.size) && cachedText.size !== item.stat.size) {
          text = null;
          buffer = null;
          hash = null;
        }
        if (Number.isFinite(cachedText.mtimeMs) && cachedText.mtimeMs !== item.stat.mtimeMs) {
          text = null;
          buffer = null;
          hash = null;
        }
      } else if (cachedText && typeof cachedText === 'object' && !item.stat) {
        // Without stat metadata we cannot validate freshness; force a re-read.
        text = null;
        buffer = null;
        hash = null;
      }
      try {
        if (typeof text !== 'string') {
          if (fileTextByFile?.captureBuffers) {
            const decoded = await readTextFileWithHash(item.absPath);
            text = decoded.text;
            buffer = decoded.buffer;
            hash = decoded.hash;
          } else {
            ({ text } = await readTextFile(item.absPath));
          }
          if (fileTextByFile?.set) {
            fileTextByFile.set(relKey, fileTextByFile.captureBuffers
              ? {
                text,
                buffer,
                hash,
                size: item.stat?.size ?? null,
                mtimeMs: item.stat?.mtimeMs ?? null
              }
              : text);
          }
        }
      } catch {
        processed += 1;
        showProgress('Imports', processed, items.length, progressMeta);
        return;
      }
      const fastImports = await collectModuleImportsFast({ text, ext });
      const options = languageOptions && typeof languageOptions === 'object' ? languageOptions : {};
      const imports = normalizeImports(Array.isArray(fastImports)
        ? fastImports
        : collectLanguageImports({
          ext,
          relPath: relKey,
          text,
          mode,
          options,
          root,
          filePath: item.absPath
        }));
      recordImports(imports);
      processed += 1;
      showProgress('Imports', processed, items.length, progressMeta);
    },
    { collectResults: false }
  );

  showProgress('Imports', items.length, items.length, progressMeta);
  const dedupedImportsByFile = Object.create(null);
  const fileKeys = Array.from(importsByFile.keys()).sort(sortStrings);
  for (const file of fileKeys) {
    dedupedImportsByFile[file] = importsByFile.get(file) || [];
  }
  return {
    importsByFile: dedupedImportsByFile,
    durationMs: Date.now() - start,
    stats: {
      modules: moduleSet.size,
      edges: edgeCount,
      files: filesWithImports,
      scanned: processed
    }
  };
}

