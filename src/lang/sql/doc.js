/**
 * Normalize SQL-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{
 *   doc:string,
 *   params:string[],
 *   returns:(string|null),
 *   signature:(string|null),
 *   dialect:(string|null),
 *   dataflow:(object|null),
 *   throws:string[],
 *   awaits:string[],
 *   yields:boolean,
 *   returnsValue:boolean,
 *   controlFlow:(object|null)
 * }}
 */
export function extractSqlDocMeta(chunk) {
  const meta = chunk.meta || {};
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params: [],
    returns: null,
    signature: meta.signature || null,
    dialect: meta.dialect || null,
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}
