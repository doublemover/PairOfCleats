import escomplex from 'escomplex';
import { ESLint } from 'eslint';

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
    const eslint = new ESLint({ useEslintrc: false });
    const results = await eslint.lintText(text, { filePath: relPath });
    return results.length ? results[0].messages : [];
  } catch {
    return [];
  }
}
