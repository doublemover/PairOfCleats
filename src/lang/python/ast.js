import { getPythonAstPool } from './pool.js';

/**
 * Parse Python source to AST metadata using a local Python interpreter.
 * Returns null when python is unavailable or parsing fails.
 * @param {string} text
 * @param {(msg:string)=>void} [log]
 * @returns {Promise<object|null>}
 */
export async function getPythonAst(text, log, options = {}) {
  const pool = await getPythonAstPool(log, options.pythonAst || {});
  if (!pool) return null;
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const path = typeof options.path === 'string' && options.path.trim()
    ? options.path.trim()
    : null;
  return pool.request(text, {
    dataflow: dataflowEnabled,
    controlFlow: controlFlowEnabled,
    path
  });
}
