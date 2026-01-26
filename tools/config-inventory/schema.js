const normalizeType = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.type)) return schema.type.join('|');
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.enum)) return 'enum';
  return null;
};

const normalizeEnum = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (!Array.isArray(schema.enum)) return null;
  return schema.enum.map((value) => String(value));
};

export const mergeEntry = (target, incoming) => {
  if (!target.type && incoming.type) target.type = incoming.type;
  if (!target.enum && incoming.enum) target.enum = incoming.enum;
  if (target.type && incoming.type && target.type !== incoming.type) {
    const parts = new Set(String(target.type).split('|'));
    String(incoming.type).split('|').forEach((part) => parts.add(part));
    target.type = Array.from(parts).join('|');
  }
  if (target.enum && incoming.enum) {
    const merged = new Set(target.enum);
    incoming.enum.forEach((value) => merged.add(value));
    target.enum = Array.from(merged);
  }
};

export const collectSchemaEntries = (schema, prefix = '', entries = []) => {
  if (!schema || typeof schema !== 'object') return entries;
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : null;
  if (properties) {
    for (const [key, child] of Object.entries(properties)) {
      const pathKey = prefix ? `${prefix}.${key}` : key;
      entries.push({
        path: pathKey,
        type: normalizeType(child),
        enum: normalizeEnum(child)
      });
      collectSchemaEntries(child, pathKey, entries);
    }
  }
  const additional = schema.additionalProperties && typeof schema.additionalProperties === 'object'
    ? schema.additionalProperties
    : null;
  if (additional && additional.properties) {
    const pathKey = prefix ? `${prefix}.*` : '*';
    entries.push({
      path: pathKey,
      type: normalizeType(additional),
      enum: normalizeEnum(additional)
    });
    collectSchemaEntries(additional, pathKey, entries);
  }
  const items = schema.items && typeof schema.items === 'object' ? schema.items : null;
  if (items && items.properties) {
    const pathKey = prefix ? `${prefix}[]` : '[]';
    entries.push({
      path: pathKey,
      type: normalizeType(items),
      enum: normalizeEnum(items)
    });
    collectSchemaEntries(items, pathKey, entries);
  }
  return entries;
};

export const getLeafEntries = (entries) => {
  const prefixes = new Set();
  for (const entry of entries) {
    const parts = entry.path.split('.');
    let prefix = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      prefix = prefix ? `${prefix}.${parts[i]}` : parts[i];
      prefixes.add(prefix);
    }
  }
  return entries.filter((entry) => !prefixes.has(entry.path));
};
