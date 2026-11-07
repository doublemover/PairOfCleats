const shape = schema => ({
  required: Array.isArray(schema?.required) ? [...schema.required].sort() : [],
  properties: Object.keys(schema?.properties || {}).sort(),
  ...(schema?.oneOf ? { alternatives: schema.oneOf.map(shape) } : {})
});
/** Keep closed request alternatives observable instead of snapshotting an
 * empty root property list for a useful discriminated tool contract. */
export const snapshotMcpToolShape = tool => ({ name: tool.name, ...shape(tool.inputSchema) });
