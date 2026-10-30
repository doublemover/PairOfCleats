import { buildCodeRelations } from './relations.js';
import { projectJavaScriptDeclaration } from './declaration-projection.js';
import { throwIfAborted } from '../../shared/abort.js';
const prepared = new WeakMap();

/** One invocation-owned relation traversal over the existing AST, shared by
 * relation/doc/flow projections. No per-chunk parse or native handle cloning. */
export const preparedJavaScriptRelations = (text, relPath, context, options = {}) => {
  throwIfAborted(options.abortSignal || options.signal);
  const dataflow = options.astDataflowEnabled !== false, controlFlow = options.controlFlowEnabled !== false;
  const parserKey = JSON.stringify([options.ext, options.parser || options.javascript?.parser || options.javascriptParser,
    options.flowMode ?? options.flow ?? options.javascript?.flow ?? options.javascriptFlow]);
  const cached = context && typeof context === 'object' ? prepared.get(context) : null;
  if (cached && cached.text === text && cached.ast === context.jsAst && cached.relPath === relPath
    && cached.dataflow === dataflow && cached.controlFlow === controlFlow && cached.parserKey === parserKey) return cached.relations;
  const relations = buildCodeRelations(text, relPath, { ...options, ast: context?.jsAst, dataflow, controlFlow });
  if (context && typeof context === 'object') prepared.set(context, { text, ast: context.jsAst, relPath, dataflow, controlFlow, parserKey, relations });
  return relations;
};

export const preparedJavaScriptFlow = ({ text, chunk, context, options = {} }) => {
  throwIfAborted(options.abortSignal || options.signal);
  const analysis = { dataflow: options.astDataflowEnabled !== false, controlFlow: options.controlFlowEnabled !== false };
  const cached = context && typeof context === 'object' ? prepared.get(context) : null;
  const relations = cached?.text === text && cached.ast === context?.jsAst && cached.dataflow === analysis.dataflow && cached.controlFlow === analysis.controlFlow ? cached.relations
    : (analysis.dataflow || analysis.controlFlow) && context?.jsAst
      ? preparedJavaScriptRelations(text, null, context, options) : null;
  const projected = projectJavaScriptDeclaration(text, chunk, relations, analysis);
  const fields = ['dataflow', 'controlFlow', 'throws', 'awaits', 'yields', 'returnsValue'];
  return { ...Object.fromEntries(fields.filter(field => projected.metadata[field] != null).map(field => [field, projected.metadata[field]])),
    flowEvidence: projected.flowEvidence };
};
