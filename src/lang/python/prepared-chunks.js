import { buildPythonChunksFromAst } from './chunks-from-ast.js';
import { buildPythonHeuristicChunks } from './chunks-heuristic.js';

const preparations = new WeakMap();
const conversions = Object.freeze({ ast: buildPythonChunksFromAst, heuristic: buildPythonHeuristicChunks });
const hasChunks = chunks => Array.isArray(chunks) && chunks.length > 0;

/** One preparation belongs to this exact source and AST input. Its weak receipt
 * follows the real language context through object spread, without a path cache
 * or a second copy of the chunks retained for Python metadata matching. */
export const preparePythonChunkContext = ({ text, pythonAst = null, pythonAstMetrics = null }, convert = conversions) => {
  let chunks = pythonAst ? convert.ast(text, pythonAst) : null;
  const kind = hasChunks(chunks) ? 'ast' : 'heuristic';
  if (kind === 'heuristic') chunks = convert.heuristic(text);
  const receipt = Object.freeze({});
  preparations.set(receipt, { text, ast: pythonAst, chunks, kind });
  return { pythonAst, pythonAstMetrics, pythonChunks: chunks, pythonChunkPreparation: receipt };
};

/** Null/empty preparation is an observed outcome, not a cache miss. AST chunks
 * retain priority over native chunks; native chunks retain priority over a
 * prepared heuristic fallback. Limits are still applied by normal dispatch. */
export const resolvePythonPreparedChunks = (text, context = {}, convert = conversions) => {
  const prepared = preparations.get(context?.pythonChunkPreparation);
  if (prepared && prepared.text === text && context.pythonAst === prepared.ast && context.pythonChunks === prepared.chunks) {
    if (prepared.kind !== 'ast' && hasChunks(context.pythonTreeChunks)) return context.pythonTreeChunks;
    return prepared.chunks;
  }
  // A source change invalidates its original AST as well as its chunk ranges.
  // A separately supplied replacement AST retains the existing direct route.
  const staleAst = prepared && prepared.text !== text && context.pythonAst === prepared.ast;
  const ast = staleAst ? null : context?.pythonAst;
  const chunks = ast ? convert.ast(text, ast) : null;
  if (hasChunks(chunks)) return chunks;
  if (!staleAst && hasChunks(context?.pythonTreeChunks)) return context.pythonTreeChunks;
  return convert.heuristic(text);
};
