/**
 * Normalize Python-specific doc metadata for search output.
 * @param {{meta?:Object,start?:number,end?:number,name?:string}} chunk
 * @param {object|null} _fileRelations
 * @param {{pythonChunks?:Array<object>}|null} context
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null),decorators:string[],fields:Array<{name:string,type:(string|null),default:(string|null)}>>}}
 */
const findMatchingContextChunk = (chunk, context) => {
  if (!chunk || !context || !Array.isArray(context.pythonChunks)) return null;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of context.pythonChunks) {
    if (!candidate || typeof candidate !== 'object') continue;
    const sameName = chunk.name && candidate.name && chunk.name === candidate.name;
    const overlaps = Number.isFinite(chunk.start)
      && Number.isFinite(chunk.end)
      && Number.isFinite(candidate.start)
      && Number.isFinite(candidate.end)
      && candidate.start < chunk.end
      && chunk.start < candidate.end;
    if (!sameName && !overlaps) continue;
    const startDiff = Number.isFinite(chunk.start) && Number.isFinite(candidate.start)
      ? Math.abs(chunk.start - candidate.start)
      : 0;
    const endDiff = Number.isFinite(chunk.end) && Number.isFinite(candidate.end)
      ? Math.abs(chunk.end - candidate.end)
      : 0;
    const score = (sameName ? 0 : 10_000) + startDiff + endDiff;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
};

export function extractPythonDocMeta(chunk, _fileRelations = null, context = null) {
  const matched = findMatchingContextChunk(chunk, context);
  const meta = { ...(chunk?.meta || {}), ...(matched?.meta || {}) };
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
