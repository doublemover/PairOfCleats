/**
 * Extract lightweight doc metadata for JS chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @returns {{doc:string,params:string[],returns:boolean,signature:(string|null)}}
 */
export function extractDocMeta(text, chunk, astMeta = null) {
  const chunkText = text.slice(chunk.start, chunk.end);
  const lines = chunkText.split('\n');
  const docLines = lines.filter((l) =>
    l.trim().startsWith('*') || l.trim().startsWith('//') || l.trim().startsWith('#')
  );
  const params = [...chunkText.matchAll(/@param +(\w+)/g)].map((m) => m[1]);
  const returnsDoc = !!chunkText.match(/@returns? /);
  const returnTypeMatch = chunkText.match(/@returns?\s+{([^}]+)}/);
  const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : null;
  const paramTypes = {};
  for (const match of chunkText.matchAll(/@param\s+{([^}]+)}\s+(\w+)/g)) {
    paramTypes[match[2]] = match[1].trim();
  }
  let signature = null;
  const matchFn = chunkText.match(/function\s+([A-Za-z0-9_$]+)?\s*\(([^\)]*)\)/);
  if (matchFn) {
    signature = `function ${matchFn[1] || ''}(${matchFn[2]})`;
  }

  const nameMeta = astMeta?.functionMeta?.[chunk.name] || astMeta?.classMeta?.[chunk.name] || null;
  const metaParams = Array.isArray(nameMeta?.params) && nameMeta.params.length ? nameMeta.params : params;
  const mergedSignature = nameMeta?.signature || signature;
  const mergedReturnType = nameMeta?.returnType || returnType || null;

  return {
    doc: docLines.join('\n').slice(0, 300),
    params: metaParams,
    paramTypes,
    paramDefaults: nameMeta?.paramDefaults || {},
    returnType: mergedReturnType,
    returnsValue: nameMeta?.returnsValue || false,
    returns: returnsDoc,
    signature: mergedSignature,
    modifiers: nameMeta?.modifiers || null,
    methodKind: nameMeta?.methodKind || null,
    dataflow: nameMeta?.dataflow || null,
    controlFlow: nameMeta?.controlFlow || null,
    throws: nameMeta?.throws || [],
    awaits: nameMeta?.awaits || [],
    yields: nameMeta?.yields || false,
    extends: nameMeta?.extends || astMeta?.classMeta?.[chunk.name]?.extends || []
  };
}
