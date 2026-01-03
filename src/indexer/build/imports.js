import fs from 'node:fs/promises';
import path from 'node:path';
import { init as initEsModuleLexer, parse as parseEsModuleLexer } from 'es-module-lexer';
import { init as initCjsLexer, parse as parseCjsLexer } from 'cjs-module-lexer';
import { collectLanguageImports } from '../language-registry.js';
import { isJsLike, isTypeScript } from '../constants.js';
import { runWithConcurrency, runWithQueue } from '../../shared/concurrency.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';

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
      if (Array.isArray(result.imports)) {
        result.imports.forEach((imp) => {
          if (imp) imports.add(imp);
        });
      }
      if (Array.isArray(result.reexports)) {
        result.reexports.forEach((imp) => {
          if (imp) imports.add(imp);
        });
      }
    }
  } catch {}
  return success ? Array.from(imports) : null;
};

/**
 * Scan files for imports to build cross-link map.
 * @param {{files:string[],root:string,mode:'code'|'prose',languageOptions:object,importConcurrency:number,queue?:object}} input
 * @returns {Promise<{allImports:Record<string,string[]>,durationMs:number}>}
 */
export async function scanImports({ files, root, mode, languageOptions, importConcurrency, queue = null }) {
  const allImports = new Map();
  const start = Date.now();
  let processed = 0;
  const runner = queue
    ? (items, worker, options) => runWithQueue(queue, items, worker, options)
    : (items, worker, options) => runWithConcurrency(items, importConcurrency, worker, options);

  await runner(
    files,
    async (absPath) => {
      const rel = path.relative(root, absPath);
      const relKey = toPosix(rel);
      const ext = fileExt(rel);
      let text;
      try {
        text = await fs.readFile(absPath, 'utf8');
      } catch {
        processed += 1;
        showProgress('Imports', processed, files.length);
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
      for (const mod of imports) {
        if (!allImports.has(mod)) allImports.set(mod, new Set());
        allImports.get(mod).add(relKey);
      }
      processed += 1;
      showProgress('Imports', processed, files.length);
    },
    { collectResults: false }
  );

  showProgress('Imports', files.length, files.length);
  const dedupedImports = {};
  for (const [mod, entries] of allImports.entries()) {
    dedupedImports[mod] = Array.from(entries);
  }
  return { allImports: dedupedImports, durationMs: Date.now() - start };
}
