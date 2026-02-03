import { ARTIFACT_SCHEMA_DEFS, ARTIFACT_SCHEMA_HASH } from '../contracts/registry.js';

const resolveObjectSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type === 'object' && schema.properties) return schema;
  if (schema.type === 'array') return resolveObjectSchema(schema.items);
  const variants = schema.anyOf || schema.oneOf;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      const resolved = resolveObjectSchema(variant);
      if (resolved) return resolved;
    }
  }
  return null;
};

const extractSchemaVersion = (schema) => {
  const target = schema?.properties?.schemaVersion;
  if (!target || typeof target !== 'object') return null;
  const info = {};
  if (Object.prototype.hasOwnProperty.call(target, 'const')) {
    info.const = target.const;
  }
  if (Array.isArray(target.enum)) {
    info.enum = target.enum.slice();
  }
  if (target.type) {
    info.type = target.type;
  }
  if (target.pattern) {
    info.pattern = target.pattern;
  }
  return Object.keys(info).length ? info : null;
};

const extractFields = (schema) => {
  const resolved = resolveObjectSchema(schema);
  const properties = resolved?.properties && typeof resolved.properties === 'object'
    ? Object.keys(resolved.properties)
    : [];
  const required = Array.isArray(resolved?.required) ? resolved.required.slice() : [];
  const requiredSet = new Set(required);
  const optional = properties.filter((name) => !requiredSet.has(name));
  required.sort();
  optional.sort();
  return {
    requiredFields: required,
    optionalFields: optional,
    schemaVersion: extractSchemaVersion(resolved)
  };
};

export const buildArtifactSchemaIndex = () => {
  const artifacts = Object.keys(ARTIFACT_SCHEMA_DEFS)
    .sort()
    .map((artifact) => {
      const schema = ARTIFACT_SCHEMA_DEFS[artifact];
      const fields = extractFields(schema);
      return {
        artifact,
        schemaVersion: fields.schemaVersion,
        requiredFields: fields.requiredFields,
        optionalFields: fields.optionalFields
      };
    });
  return {
    schemaHash: ARTIFACT_SCHEMA_HASH,
    artifacts
  };
};
