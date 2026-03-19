const normalizeDialect = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw || null;
};

const resolveChunkDialect = (chunk, options = {}) => {
  const metaDialect = normalizeDialect(chunk?.meta?.dialect);
  if (metaDialect && metaDialect !== 'generic') return metaDialect;
  const resolveSqlDialect = typeof options?.resolveSqlDialect === 'function'
    ? options.resolveSqlDialect
    : null;
  const extCandidates = [
    chunk?.ext,
    chunk?.segment?.ext,
    chunk?.container?.ext
  ];
  for (const ext of extCandidates) {
    const normalizedExt = typeof ext === 'string' ? ext.trim().toLowerCase() : '';
    if (!normalizedExt) continue;
    const resolved = normalizeDialect(resolveSqlDialect ? resolveSqlDialect(normalizedExt) : null);
    if (resolved) return resolved;
  }
  return metaDialect || 'generic';
};

/**
 * Normalize SQL-specific doc metadata for search output.
 * @param {{chunk?:{meta?:Object,ext?:string,segment?:{ext?:string},container?:{ext?:string}},options?:object}} input
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
export function extractSqlDocMeta(input = {}, legacyOptions = undefined) {
  const chunk = input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'chunk')
    ? input.chunk
    : input;
  const options = input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'chunk')
    ? input.options
    : legacyOptions;
  const meta = chunk.meta || {};
  return {
    doc: meta.docstring ? String(meta.docstring).slice(0, 300) : '',
    params: [],
    returns: null,
    signature: meta.signature || null,
    dialect: resolveChunkDialect(chunk, options),
    dataflow: meta.dataflow || null,
    throws: meta.throws || [],
    awaits: meta.awaits || [],
    yields: meta.yields || false,
    returnsValue: meta.returnsValue || false,
    controlFlow: meta.controlFlow || null
  };
}
