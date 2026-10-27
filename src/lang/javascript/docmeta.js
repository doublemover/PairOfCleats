import { projectJavaScriptDeclaration } from './declaration-projection.js';
import { resolveStandaloneJavaScriptDocumentation } from './doc-comments.js';
/**
 * Extract lightweight doc metadata for JS chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @returns {{doc:string,params:string[],returns:boolean,signature:(string|null)}}
 */
export function extractDocMeta(text, chunk, astMeta = null, sourceView = null) {
  const chunkText = text.slice(chunk.start, chunk.end);
  const projection = projectJavaScriptDeclaration(text, chunk, astMeta, astMeta?.jsDeclarations?.analysis, sourceView);
  const nameMeta = projection.join.record ? projection.metadata : null;
  const documentation = projection.join.record?.documentation || resolveStandaloneJavaScriptDocumentation(text, chunk);
  const params = documentation.parameters.map(parameter => parameter.name);
  const paramTypes = { ...Object.fromEntries(documentation.parameters.filter(parameter => parameter.type)
    .map(parameter => [parameter.name, parameter.type])), ...(nameMeta?.paramTypes || {}) };
  const metaParams = Array.isArray(nameMeta?.params) ? nameMeta.params : params;
  const metaParamNames = Array.isArray(nameMeta?.paramNames)
    ? nameMeta.paramNames
    : metaParams;
  const chunkSignature = typeof chunk.meta?.signature === 'string' && chunk.meta.signature.trim()
    ? chunk.meta.signature : null;
  let mergedSignature = nameMeta?.signature || chunkSignature;
  if (!mergedSignature) {
    const matchFn = chunkText.match(/function\s+([A-Za-z0-9_$]+)?\s*\(([^\)]*)\)/);
    if (matchFn) mergedSignature = `function ${matchFn[1] || ''}(${matchFn[2]})`;
  }
  const mergedReturnType = nameMeta?.returnType || documentation.returnType || null;

  return {
    doc: documentation.range ? text.slice(documentation.range.start, documentation.range.end).slice(0, 300) : '',
    documentation: { ...documentation, authority: 'documentation', range: documentation.range ? {
      start: documentation.range.start + (sourceView?.offset || 0),
      end: documentation.range.end + (sourceView?.offset || 0)
    } : null },
    params: metaParams,
    paramNames: metaParamNames,
    paramTypes,
    paramDefaults: nameMeta?.paramDefaults || {},
    paramDefaultLiterals: nameMeta?.paramDefaultLiterals || {},
    ...(nameMeta?.callableParameters ? { callableParameters: nameMeta.callableParameters } : {}),
    returnType: mergedReturnType,
    returns: documentation.returns,
    signature: mergedSignature,
    modifiers: nameMeta?.modifiers || null,
    methodKind: nameMeta?.methodKind || null,
    ...Object.fromEntries(['dataflow', 'controlFlow', 'throws', 'awaits', 'yields', 'returnsValue'].filter(field => nameMeta?.[field] != null).map(field => [field, nameMeta[field]])),
    flowEvidence: projection.flowEvidence,
    javascriptDeclaration: projection.javascriptDeclaration,
    extends: nameMeta?.extends || []
  };
}
