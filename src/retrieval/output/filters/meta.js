import { collectDeclaredReturnTypes, collectMetaV2ReturnTypes } from '../../../shared/docmeta.js';
import { defaultNormalize, matchList } from './predicates.js';

const asObject = (value) => (value && typeof value === 'object' ? value : null);
const asNonEmptyArray = (value) => (Array.isArray(value) && value.length ? value : null);
const asNonEmptyObject = (value) => {
  const objectValue = asObject(value);
  if (!objectValue) return null;
  return Object.keys(objectValue).length ? objectValue : null;
};
const mergeObjectWithFallback = (preferred, fallback) => {
  const preferredObject = asObject(preferred);
  const fallbackObject = asObject(fallback);
  if (!preferredObject && !fallbackObject) return null;
  if (!preferredObject) return fallbackObject;
  if (!fallbackObject) return preferredObject;
  const merged = { ...fallbackObject };
  for (const [key, value] of Object.entries(preferredObject)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const fallbackValue = merged[key];
      merged[key] = value.length
        ? value
        : (Array.isArray(fallbackValue) ? fallbackValue : value);
      continue;
    }
    if (typeof value === 'object') {
      const fallbackValue = asObject(merged[key]);
      if (Object.keys(value).length) {
        merged[key] = fallbackValue ? { ...fallbackValue, ...value } : value;
      } else {
        merged[key] = fallbackValue || value;
      }
      continue;
    }
    merged[key] = value;
  }
  return merged;
};

const resolveMetaField = (record, key) => {
  if (!record || typeof record !== 'object' || !key) return undefined;
  if (!key.includes('.')) return record[key];
  return key
    .split('.')
    .reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), record);
};

export const resolveReturnTypes = (chunk) => {
  const declared = collectDeclaredReturnTypes(chunk?.docmeta);
  const metaDeclared = collectMetaV2ReturnTypes(chunk?.metaV2);
  if (!declared.length && !metaDeclared.length) return [];
  return Array.from(new Set([...declared, ...metaDeclared]));
};

const matchInferredType = (inferred, value, normalize = defaultNormalize) => {
  if (!value) return true;
  if (!inferred) return false;
  const needle = normalize(value);
  const types = [];
  const collect = (entries) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (entry?.type) types.push(entry.type);
    }
  };
  const collectMap = (map) => {
    if (!map || typeof map !== 'object') return;
    Object.values(map).forEach((entries) => collect(entries));
  };
  collectMap(inferred.params);
  collectMap(inferred.fields);
  collectMap(inferred.locals);
  collect(inferred.returns);
  if (!types.length) return false;
  return types.some((entry) => normalize(entry).includes(needle));
};

const resolveChunkDocmeta = (chunk) => mergeObjectWithFallback(chunk?.docmeta, chunk?.metaV2);

const resolveChunkRecordMeta = (chunk, docmeta) => (
  mergeObjectWithFallback(chunk?.docmeta?.record, chunk?.metaV2?.record)
  || asNonEmptyObject(docmeta?.record)
  || asObject(chunk?.docmeta?.record)
  || asObject(chunk?.metaV2?.record)
  || asObject(docmeta?.record)
  || null
);

const resolveChunkParamList = (chunk, docmeta) => {
  if (asNonEmptyArray(chunk?.docmeta?.params)) return chunk.docmeta.params;
  if (asNonEmptyArray(chunk?.metaV2?.params)) return chunk.metaV2.params;
  if (asNonEmptyArray(docmeta?.params)) return docmeta.params;
  if (Array.isArray(chunk?.docmeta?.params)) return chunk.docmeta.params;
  if (Array.isArray(chunk?.metaV2?.params)) return chunk.metaV2.params;
  if (Array.isArray(docmeta?.params)) return docmeta.params;
  return null;
};

const resolveChunkInferredTypes = (chunk, docmeta) => {
  if (asNonEmptyObject(chunk?.docmeta?.inferredTypes)) return chunk.docmeta.inferredTypes;
  if (asNonEmptyObject(chunk?.metaV2?.types?.inferred)) return chunk.metaV2.types.inferred;
  if (asNonEmptyObject(docmeta?.inferredTypes)) return docmeta.inferredTypes;
  if (asObject(chunk?.docmeta?.inferredTypes)) return chunk.docmeta.inferredTypes;
  if (asObject(chunk?.metaV2?.types?.inferred)) return chunk.metaV2.types.inferred;
  if (asObject(docmeta?.inferredTypes)) return docmeta.inferredTypes;
  return null;
};

const resolveChunkRiskMeta = (chunk, docmeta) => (
  asNonEmptyObject(chunk?.docmeta?.risk)
  || asNonEmptyObject(chunk?.metaV2?.risk)
  || asNonEmptyObject(docmeta?.risk)
  || asObject(chunk?.docmeta?.risk)
  || asObject(chunk?.metaV2?.risk)
  || asObject(docmeta?.risk)
  || null
);

export const matchMetaFilters = ({
  chunk,
  metaFilters,
  param,
  returnType,
  inferredType,
  risk,
  riskTag,
  riskSource,
  riskSink,
  riskCategory,
  riskFlow,
  normalize = defaultNormalize
}) => {
  const hasMetaFilters = Array.isArray(metaFilters) && metaFilters.length;
  const hasParam = !!param;
  const hasReturnType = !!returnType;
  const hasInferredType = !!inferredType;
  const hasRiskFilters = !!(risk || riskTag || riskSource || riskSink || riskCategory || riskFlow);
  if (!hasMetaFilters && !hasParam && !hasReturnType && !hasInferredType && !hasRiskFilters) return true;
  const docmeta = resolveChunkDocmeta(chunk);

  if (hasMetaFilters) {
    const recordMeta = resolveChunkRecordMeta(chunk, docmeta);
    if (!recordMeta || typeof recordMeta !== 'object') return false;
    for (const filter of metaFilters) {
      const key = filter?.key;
      if (!key) continue;
      const value = filter?.value;
      const field = resolveMetaField(recordMeta, key);
      if (value == null || value === '') {
        if (field == null) return false;
        if (Array.isArray(field) && field.length === 0) return false;
        if (typeof field === 'string' && !field.trim()) return false;
        continue;
      }
      const needle = normalize(value);
      if (Array.isArray(field)) {
        if (!field.some((entry) => normalize(entry).includes(needle))) return false;
      } else if (field && typeof field === 'object') {
        if (!normalize(JSON.stringify(field)).includes(needle)) return false;
      } else if (!normalize(field).includes(needle)) {
        return false;
      }
    }
  }

  if (param) {
    const params = resolveChunkParamList(chunk, docmeta);
    if (!Array.isArray(params) || !params.includes(param)) return false;
  }

  if (returnType) {
    const returnTypes = resolveReturnTypes(chunk);
    if (!returnTypes.length || !returnTypes.some((entry) => normalize(entry).includes(normalize(returnType)))) {
      return false;
    }
  }

  if (inferredType && !matchInferredType(resolveChunkInferredTypes(chunk, docmeta), inferredType, normalize)) {
    return false;
  }

  if (hasRiskFilters) {
    const riskMeta = resolveChunkRiskMeta(chunk, docmeta);
    const riskTagValue = riskTag || risk;
    if (riskTagValue && !matchList(riskMeta?.tags, riskTagValue, normalize)) return false;
    if (riskSource) {
      const sourceNames = Array.isArray(riskMeta?.sources)
        ? riskMeta.sources.map((source) => source.name)
        : null;
      if (!matchList(sourceNames, riskSource, normalize)) return false;
    }
    if (riskSink) {
      const sinkNames = Array.isArray(riskMeta?.sinks)
        ? riskMeta.sinks.map((sink) => sink.name)
        : null;
      if (!matchList(sinkNames, riskSink, normalize)) return false;
    }
    if (riskCategory) {
      const categories = Array.isArray(riskMeta?.categories)
        ? riskMeta.categories
        : (Array.isArray(riskMeta?.sinks) ? riskMeta.sinks.map((sink) => sink.category) : null);
      if (!matchList(categories, riskCategory, normalize)) return false;
    }
    if (riskFlow) {
      const flows = Array.isArray(riskMeta?.flows)
        ? riskMeta.flows.map((flow) => `${flow.source}->${flow.sink}`)
        : null;
      if (!matchList(flows, riskFlow, normalize)) return false;
    }
  }

  return true;
};
