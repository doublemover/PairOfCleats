import fs from 'node:fs/promises';
import path from 'node:path';
import { init as initEsModuleLexer, parse as parseEsModuleLexer } from 'es-module-lexer';
import { init as initCjsLexer, parse as parseCjsLexer } from 'cjs-module-lexer';
import { collectLanguageImports } from '../language-registry.js';
import { isJsLike, isTypeScript } from '../constants.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';
import { readCachedImports } from './incremental.js';

let esModuleInitPromise = null;
let cjsInitPromise = null;

const ensureEsModuleLexer = async () => {
  if (!esModuleInitPromise) esModuleInitPromise = initEsModuleLexer;
  await esModuleInitPromise;
};

const ensureCjsLexer = async () => {
  if (!cjsInitPromise) cjsInitPromise = initCjsLexer();
  await cjsInitPromise;
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
        if (entry?.n) imports.add(entry.n);
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
  return success ? Array.from(imports) : null;
};

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
          bundleDir: incrementalState.bundleDir
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
    const haveCounts = cachedImportCounts.size > 0;
    items.sort((a, b) => {
      const aSize = a.stat?.size || 0;
      const bSize = b.stat?.size || 0;
      if (bSize !== aSize) return bSize - aSize;
      if (haveCounts) {
        const aCount = cachedImportCounts.get(a.relKey);
        const bCount = cachedImportCounts.get(b.relKey);
        const aHas = Number.isFinite(aCount);
        const bHas = Number.isFinite(bCount);
        if (aHas || bHas) {
          if (!aHas) return 1;
          if (!bHas) return -1;
          if (bCount !== aCount) return bCount - aCount;
        }
      }
      return a.index - b.index;
    });
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
        showProgress('Imports', processed, items.length);
        return;
      }
      if (incrementalState?.enabled && item.stat) {
        const cachedImportsFallback = await readCachedImports({
          enabled: true,
          absPath: item.absPath,
          relKey,
          fileStat: item.stat,
          manifest: incrementalState.manifest,
          bundleDir: incrementalState.bundleDir
        });
        if (Array.isArray(cachedImportsFallback)) {
          for (const mod of cachedImportsFallback) {
            if (!allImports.has(mod)) allImports.set(mod, new Set());
            allImports.get(mod).add(relKey);
          }
          if (cachedImportsFallback.length > 0) filesWithImports += 1;
          processed += 1;
          showProgress('Imports', processed, items.length);
          return;
        }
      }
      let text;
      try {
        text = await fs.readFile(item.absPath, 'utf8');
      } catch {
        processed += 1;
        showProgress('Imports', processed, items.length);
        return;
      }
      const fastImports = await collectModuleImportsFast({ text, ext });
      const imports = Array.isArray(fastImports)
        ? fastImports
        : collectLanguageImports({
          ext,
          relPath: relKey,
          text,
          mode,
          options: languageOptions
        });
      if (imports.length > 0) filesWithImports += 1;
      for (const mod of imports) {
        if (!allImports.has(mod)) allImports.set(mod, new Set());
        allImports.get(mod).add(relKey);
      }
      processed += 1;
      showProgress('Imports', processed, items.length);
    },
    { collectResults: false }
  );

  showProgress('Imports', items.length, items.length);
  const dedupedImports = {};
  for (const [mod, entries] of allImports.entries()) {
    dedupedImports[mod] = Array.from(entries);
  }
  let edgeCount = 0;
  for (const entries of allImports.values()) {
    edgeCount += entries.size;
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
