import { isCLike } from './constants.js';
import { fileExt } from '../shared/files.js';

/**
 * Assign a scoring weight based on chunk kind and file path.
 * @param {{kind?:string}} meta
 * @param {string} file
 * @returns {number}
 */
export function getFieldWeight(meta, file) {
  if (/test/i.test(file)) return 0.5;
  if (meta.kind === 'FunctionDeclaration') return 2.0;
  if (meta.kind === 'ClassDeclaration') return 1.5;
  const ext = fileExt(file);
  if (ext === '.js') return 1.2;
  if (ext === '.py') return 1.2;
  if (ext === '.swift') return 1.2;
  if (ext === '.rs') return 1.2;
  if (isCLike(ext)) return 1.1;
  if (ext === '.md') return 0.8;
  return 1.0;
}
