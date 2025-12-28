import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLanguageImports } from '../language-registry.js';
import { runWithConcurrency } from '../../shared/concurrency.js';
import { fileExt, toPosix } from '../../shared/files.js';
import { showProgress } from '../../shared/progress.js';

/**
 * Scan files for imports to build cross-link map.
 * @param {{files:string[],root:string,mode:'code'|'prose',languageOptions:object,importConcurrency:number}} input
 * @returns {Promise<{allImports:Record<string,string[]>,durationMs:number}>}
 */
export async function scanImports({ files, root, mode, languageOptions, importConcurrency }) {
  const allImports = {};
  const start = Date.now();
  let processed = 0;

  await runWithConcurrency(files, importConcurrency, async (absPath) => {
    const rel = path.relative(root, absPath);
    const relKey = toPosix(rel);
    const ext = fileExt(rel);
    let text;
    try {
      text = await fs.readFile(absPath, 'utf8');
    } catch {
      processed++;
      showProgress('Imports', processed, files.length);
      return;
    }
    const imports = collectLanguageImports({
      ext,
      relPath: relKey,
      text,
      mode,
      options: languageOptions
    });
    for (const mod of imports) {
      if (!allImports[mod]) allImports[mod] = [];
      allImports[mod].push(relKey);
    }
    processed++;
    showProgress('Imports', processed, files.length);
  });

  showProgress('Imports', files.length, files.length);
  return { allImports, durationMs: Date.now() - start };
}
