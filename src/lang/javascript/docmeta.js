/**
 * Extract lightweight doc metadata for JS chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @returns {{doc:string,params:string[],returns:boolean,signature:(string|null)}}
 */
export function extractDocMeta(text, chunk, astMeta = null) {
  const chunkText = text.slice(chunk.start, chunk.end);
  const docLines = [];
  const params = [];
  const paramTypes = {};
  let returnsDoc = false;
  let returnType = null;

  if (
    chunkText.includes('//')
    || chunkText.includes('/*')
    || chunkText.includes('\n*')
    || chunkText.includes('\n#')
    || chunkText.trimStart().startsWith('*')
    || chunkText.trimStart().startsWith('#')
  ) {
    const lines = chunkText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        docLines.push(line);
      }
    }
  }

  if (chunkText.includes('@param')) {
    const paramRe = /@param\s+(?:{([^}]+)}\s+)?(\w+)/g;
    let match;
    while ((match = paramRe.exec(chunkText)) !== null) {
      const type = match[1] ? match[1].trim() : '';
      const name = match[2];
      if (!name) continue;
      params.push(name);
      if (type) paramTypes[name] = type;
      if (!match[0]) paramRe.lastIndex += 1;
    }
  }

  if (chunkText.includes('@return')) {
    returnsDoc = /@returns? /.test(chunkText);
    const returnTypeMatch = chunkText.match(/@returns?\s+{([^}]+)}/);
    returnType = returnTypeMatch ? returnTypeMatch[1].trim() : null;
  }
  let signature = null;
  const matchFn = chunkText.match(/function\s+([A-Za-z0-9_$]+)?\s*\(([^\)]*)\)/);
  if (matchFn) {
    signature = `function ${matchFn[1] || ''}(${matchFn[2]})`;
  }

  const nameMeta = astMeta?.functionMeta?.[chunk.name] || astMeta?.classMeta?.[chunk.name] || null;
  const metaParams = Array.isArray(nameMeta?.params) && nameMeta.params.length ? nameMeta.params : params;
  const metaParamNames = Array.isArray(nameMeta?.paramNames) && nameMeta.paramNames.length
    ? nameMeta.paramNames
    : metaParams;
  const mergedSignature = nameMeta?.signature || signature;
  const mergedReturnType = nameMeta?.returnType || returnType || null;

  return {
    doc: docLines.join('\n').slice(0, 300),
    params: metaParams,
    paramNames: metaParamNames,
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
