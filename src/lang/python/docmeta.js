/**
 * Normalize Python-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],fields:Array<{name:string,type:(string|null),default:(string|null)}>>}}
 */
export function extractPythonDocMeta(chunk) {
  const meta = chunk.meta || {};
  const params = Array.isArray(meta.params) ? meta.params : [];
  const decorators = Array.isArray(meta.decorators) ? meta.decorators : [];
  const fields = Array.isArray(meta.fields) ? meta.fields : [];
  const modifiers = meta.modifiers && typeof meta.modifiers === 'object' ? meta.modifiers : null;
  const dataflow = meta.dataflow && typeof meta.dataflow === 'object' ? meta.dataflow : null;
  const controlFlow = meta.controlFlow && typeof meta.controlFlow === 'object' ? meta.controlFlow : null;
  const bases = Array.isArray(meta.bases) ? meta.bases : [];
  const throws = Array.isArray(meta.throws) ? meta.throws : [];
  const awaits = Array.isArray(meta.awaits) ? meta.awaits : [];
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params,
    returnType: meta.returnType || meta.returns || null,
    returnsValue: meta.returnsValue || false,
    paramTypes: meta.paramTypes || {},
    paramDefaults: meta.paramDefaults || {},
    signature: meta.signature || null,
    decorators,
    fields,
    modifiers,
    visibility: meta.visibility || null,
    bases,
    dataflow,
    controlFlow,
    throws,
    awaits,
    yields: meta.yields || false,
    async: meta.async || false
  };
}
