import path from 'node:path';
import { init as initEsModuleLexer, parse as parseEsModuleLexer } from 'es-module-lexer';
import { init as initCjsLexer, parse as parseCjsLexer } from 'cjs-module-lexer';
import { collectLanguageImports } from '../language-registry.js';
import { isJsLike, isTypeScript } from '../constants.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { throwIfAborted } from '../../shared/abort.js';
import { readTextFile, readTextFileWithHash } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';
import { readCachedImports } from './incremental.js';

let esModuleInitPromise = null;
let cjsInitPromise = null;

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

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

const normalizeImports = (list) => {
  const set = new Set();
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry === 'string' && entry) set.add(entry);
    }
  }
  const output = Array.from(set);
  output.sort(sortStrings);
  return output;
};

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
 * @param {{files:Array<string|{abs:string,rel?:string,stat?:import('node:fs').Stats}>,root:string,mode:'code'|'prose',languageOptions:object,importConcurrency:number,queue?:object,incrementalState?:object,fileTextByFile?:Map<string,string>,readCachedImportsFn?:Function}} input
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
  throwIfAborted(abortSignal);
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
      index
    };
  });
  const runner = queue
    ? (items, worker, options) => runWithQueue(queue, items, worker, { ...(options || {}), signal: abortSignal })
    : (items, worker, options) => runWithConcurrency(items, importConcurrency, worker, { ...(options || {}), signal: abortSignal });

  const cachedImportsByFile = new Map();
  const cachedImportCounts = new Map();
  if (incrementalState?.enabled) {
    await runner(
      items,
      async (item) => {
        throwIfAborted(abortSignal);
        if (!item.stat) return;
        const cachedImports = await readCachedImportsFn({
          enabled: true,
          absPath: item.absPath,
          relKey: item.relKey,
          fileStat: item.stat,
          manifest: incrementalState.manifest,
          bundleDir: incrementalState.bundleDir,
          bundleFormat: incrementalState.bundleFormat
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
      throwIfAborted(abortSignal);
      const relKey = item.relKey;
      const ext = fileExt(relKey);
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
          bundleFormat: incrementalState.bundleFormat
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

