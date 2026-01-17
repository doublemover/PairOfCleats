import path from 'node:path';
import { init as initEsModuleLexer, parse as parseEsModuleLexer } from 'es-module-lexer';
import { init as initCjsLexer, parse as parseCjsLexer } from 'cjs-module-lexer';
import { collectLanguageImports } from '../language-registry.js';
import { isJsLike, isTypeScript } from '../constants.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { readTextFile } from '../../shared/encoding.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';
import { readCachedImports } from './incremental.js';

let esModuleInitPromise = null;
let cjsInitPromise = null;

const sortStrings = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

const ensureEsModuleLexer = async () => {
  if (!esModuleInitPromise) esModuleInitPromise = initEsModuleLexer;
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
  if (success) {
    const requireRegex = /(?:^|[^.\w$])require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
    for (const match of text.matchAll(requireRegex)) {
      if (match[1]) imports.add(match[1]);
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
 * @param {{files:Array<string|{abs:string,rel?:string,stat?:import('node:fs').Stats}>,root:string,mode:'code'|'prose',languageOptions:object,importConcurrency:number,queue?:object,incrementalState?:object}} input
 * @returns {Promise<{allImports:Record<string,string[]>,durationMs:number,stats:{modules:number,edges:number,files:number,scanned:number}}>}
 */
export async function scanImports({ files, root, mode, languageOptions, importConcurrency, queue = null, incrementalState = null }) {
  const allImports = new Map();
  const start = Date.now();
  let processed = 0;
  let filesWithImports = 0;
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
    ? (items, worker, options) => runWithQueue(queue, items, worker, options)
    : (items, worker, options) => runWithConcurrency(items, importConcurrency, worker, options);

  const cachedImportsByFile = new Map();
  const cachedImportCounts = new Map();
  if (incrementalState?.enabled) {
    await runner(
      items,
      async (item) => {
        if (!item.stat) return;
        const cachedImports = await readCachedImports({
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
        }
      },
      { collectResults: false }
    );
    sortImportScanItems(items, cachedImportCounts);
  }

  await runner(
    items,
    async (item) => {
      const relKey = item.relKey;
      const ext = fileExt(relKey);
      const cachedImports = cachedImportsByFile.get(relKey);
      if (Array.isArray(cachedImports)) {
        cachedImportsByFile.delete(relKey);
        for (const mod of cachedImports) {
          if (!allImports.has(mod)) allImports.set(mod, new Set());
          allImports.get(mod).add(relKey);
        }
        if (cachedImports.length > 0) filesWithImports += 1;
        processed += 1;
        showProgress('Imports', processed, items.length, progressMeta);
        return;
      }
      if (incrementalState?.enabled && item.stat) {
        const cachedImportsFallback = await readCachedImports({
          enabled: true,
          absPath: item.absPath,
          relKey,
          fileStat: item.stat,
          manifest: incrementalState.manifest,
          bundleDir: incrementalState.bundleDir,
          bundleFormat: incrementalState.bundleFormat
        });
        if (Array.isArray(cachedImportsFallback)) {
          for (const mod of cachedImportsFallback) {
            if (!allImports.has(mod)) allImports.set(mod, new Set());
            allImports.get(mod).add(relKey);
          }
          if (cachedImportsFallback.length > 0) filesWithImports += 1;
          processed += 1;
          showProgress('Imports', processed, items.length, progressMeta);
          return;
        }
      }
      let text;
      try {
        ({ text } = await readTextFile(item.absPath));
      } catch {
        processed += 1;
        showProgress('Imports', processed, items.length, progressMeta);
        return;
      }
      const fastImports = await collectModuleImportsFast({ text, ext });
      const imports = normalizeImports(Array.isArray(fastImports)
        ? fastImports
        : collectLanguageImports({
          ext,
          relPath: relKey,
          text,
          mode,
          options: languageOptions
        }));
      if (imports.length > 0) filesWithImports += 1;
      for (const mod of imports) {
        if (!allImports.has(mod)) allImports.set(mod, new Set());
        allImports.get(mod).add(relKey);
      }
      processed += 1;
      showProgress('Imports', processed, items.length, progressMeta);
    },
    { collectResults: false }
  );

  showProgress('Imports', items.length, items.length, progressMeta);
  const dedupedImports = {};
  const moduleKeys = Array.from(allImports.keys()).sort(sortStrings);
  let edgeCount = 0;
  for (const mod of moduleKeys) {
    const entries = Array.from(allImports.get(mod) || []).sort(sortStrings);
    dedupedImports[mod] = entries;
    edgeCount += entries.length;
  }
  return {
    allImports: dedupedImports,
    durationMs: Date.now() - start,
    stats: {
      modules: allImports.size,
      edges: edgeCount,
      files: filesWithImports,
      scanned: processed
    }
  };
}

export function buildImportLinksFromRelations(fileRelations) {
  if (!fileRelations || typeof fileRelations.entries !== 'function') {
    return { allImports: {}, stats: { modules: 0, edges: 0, files: 0, scanned: 0 } };
  }
  const moduleMap = new Map();
  let filesWithImports = 0;
  let scanned = 0;
  for (const [file, relations] of fileRelations.entries()) {
    scanned += 1;
    const imports = Array.isArray(relations?.imports) ? relations.imports : [];
    if (imports.length) filesWithImports += 1;
    for (const mod of imports) {
      if (!moduleMap.has(mod)) moduleMap.set(mod, new Set());
      moduleMap.get(mod).add(file);
    }
  }
  const dedupedImports = {};
  let edgeCount = 0;
  const moduleKeys = Array.from(moduleMap.keys()).sort(sortStrings);
  for (const mod of moduleKeys) {
    const files = Array.from(moduleMap.get(mod) || []).sort(sortStrings);
    dedupedImports[mod] = files;
    edgeCount += files.length;
  }
  for (const [file, relations] of fileRelations.entries()) {
    const imports = Array.isArray(relations?.imports) ? relations.imports : [];
    const importLinksSet = new Set();
    for (const mod of imports) {
      const files = dedupedImports[mod];
      if (!Array.isArray(files)) continue;
      for (const linked of files) {
        if (linked === file) continue;
        importLinksSet.add(linked);
      }
    }
    const importLinks = Array.from(importLinksSet).sort(sortStrings);
    fileRelations.set(file, { ...relations, importLinks });
  }
  return {
    allImports: dedupedImports,
    stats: {
      modules: moduleMap.size,
      edges: edgeCount,
      files: filesWithImports,
      scanned
    }
  };
}
