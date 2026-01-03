import escomplex from 'escomplex';
import { ESLint } from 'eslint';

let eslintInstance = null;
let eslintInitFailed = false;
let eslintInitWarned = false;

async function getEslintInstance() {
  if (eslintInitFailed) return null;
  if (eslintInstance) return eslintInstance;
  try {
    eslintInstance = new ESLint({ useEslintrc: false });
    return eslintInstance;
  } catch (err) {
    const message = String(err?.message || err || '');
    if (!eslintInitWarned && message) {
      console.warn(`[lint] ESLint init failed with legacy options: ${message}`);
      eslintInitWarned = true;
    }
    try {
      eslintInstance = new ESLint({ overrideConfigFile: null });
      if (!eslintInitWarned) {
        console.warn('[lint] ESLint fallback initialized with overrideConfigFile=null.');
        eslintInitWarned = true;
      }
      return eslintInstance;
    } catch (fallbackErr) {
      const fallbackMessage = String(fallbackErr?.message || fallbackErr || '');
      if (!eslintInitWarned && fallbackMessage) {
        console.warn(`[lint] ESLint fallback init failed: ${fallbackMessage}`);
        eslintInitWarned = true;
      }
      eslintInitFailed = true;
      return null;
    }
  }
}

/**
 * Compute basic cyclomatic complexity metrics for JS code.
 * @param {string} code
 * @returns {Promise<{functions:number,averageCyclomatic:number}|{}>}
 */
export async function analyzeComplexity(code) {
  try {
    const report = escomplex.analyse(code, { esmImportExport: true });
    return report && report.functions ? {
      functions: report.functions.length,
      averageCyclomatic: (report.aggregate && report.aggregate.cyclomatic) || 0
    } : {};
  } catch {
    return {};
  }
}

/**
 * Run ESLint on a code chunk and return lint messages.
 * @param {string} text
 * @param {string} relPath
 * @returns {Promise<Array<{message:string}>>}
 */
export async function lintChunk(text, relPath) {
  try {
    const eslint = await getEslintInstance();
    if (!eslint) return [];
    const results = await eslint.lintText(text, { filePath: relPath });
    return results.length ? results[0].messages : [];
  } catch {
    return [];
  }
}
