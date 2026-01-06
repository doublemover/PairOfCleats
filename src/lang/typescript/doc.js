import {
  extractTypeScriptInheritance,
  extractTypeScriptParamTypes,
  extractTypeScriptParams,
  extractTypeScriptReturns
} from './signature.js';

/**
 * Normalize TypeScript-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],modifiers:string[],visibility:(string|null),returnType:(string|null),extends:string[],implements:string[]}}
 */
export function extractTypeScriptDocMeta(chunk) {
  const meta = chunk.meta || {};
  const signature = meta.signature || '';
  const params = Array.isArray(meta.params) && meta.params.length
    ? meta.params
    : (signature ? extractTypeScriptParams(signature) : []);
  const paramTypes = meta.paramTypes && typeof meta.paramTypes === 'object'
    && Object.keys(meta.paramTypes).length
    ? meta.paramTypes
    : (signature ? extractTypeScriptParamTypes(signature) : {});
  const decorators = Array.isArray(meta.attributes) ? meta.attributes : [];
  const modifiers = Array.isArray(meta.modifiers) ? meta.modifiers : [];
  let extendsList = Array.isArray(meta.extends) ? meta.extends : [];
  let implementsList = Array.isArray(meta.implements) ? meta.implements : [];
  if ((!extendsList.length || !implementsList.length) && signature) {
    const inheritance = extractTypeScriptInheritance(signature);
    if (!extendsList.length && inheritance.extendsList.length) {
      extendsList = inheritance.extendsList;
    }
    if (!implementsList.length && inheritance.implementsList.length) {
      implementsList = inheritance.implementsList;
    }
  }
  const returns = meta.returns || (signature ? extractTypeScriptReturns(signature) : null);
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    paramTypes,
    returns,
    returnType: returns,
    signature: signature || null,
    decorators,
    modifiers,
    visibility: meta.visibility || null,
    extends: extendsList,
    implements: implementsList,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}
