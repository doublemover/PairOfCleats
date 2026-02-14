export const META_V2_SCHEMA_VERSION = 3;
const META_V2_FALLBACK_SCHEMA_VERSION = 2;

const DOCUMENT_SOURCE_TYPES = new Set(['pdf', 'docx']);

const normalizeString = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeNullableInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const normalizeHeadingPath = (value) => {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
  return items.length ? items : null;
};

const resolveSchemaVersion = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeDocumentSegment = (segment) => {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return segment;
  const normalized = { ...segment };
  const type = normalizeString(segment.type);
  const sourceTypeRaw = normalizeString(segment.sourceType);
  const sourceType = sourceTypeRaw || (DOCUMENT_SOURCE_TYPES.has(type) ? type : null);
  if (sourceType) normalized.sourceType = sourceType;
  if (sourceType && !type) normalized.type = sourceType;
  if (Object.prototype.hasOwnProperty.call(segment, 'anchor') || sourceType) {
    normalized.anchor = normalizeString(segment.anchor);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'pageStart') || sourceType === 'pdf') {
    normalized.pageStart = normalizeNullableInt(segment.pageStart);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'pageEnd') || sourceType === 'pdf') {
    normalized.pageEnd = normalizeNullableInt(segment.pageEnd);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'paragraphStart') || sourceType === 'docx') {
    normalized.paragraphStart = normalizeNullableInt(segment.paragraphStart);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'paragraphEnd') || sourceType === 'docx') {
    normalized.paragraphEnd = normalizeNullableInt(segment.paragraphEnd);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'windowIndex')) {
    normalized.windowIndex = normalizeNullableInt(segment.windowIndex);
  }
  if (Object.prototype.hasOwnProperty.call(segment, 'headingPath')) {
    normalized.headingPath = normalizeHeadingPath(segment.headingPath);
  }
  return normalized;
};

export const normalizeMetaV2ForRead = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = { ...value };
  normalized.schemaVersion = resolveSchemaVersion(
    value.schemaVersion,
    META_V2_FALLBACK_SCHEMA_VERSION
  );
  if (value.segment && typeof value.segment === 'object' && !Array.isArray(value.segment)) {
    normalized.segment = normalizeDocumentSegment(value.segment);
  }
  return normalized;
};

export const normalizeMetaV2ForWrite = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const normalized = normalizeMetaV2ForRead(value);
  normalized.schemaVersion = META_V2_SCHEMA_VERSION;
  return normalized;
};
