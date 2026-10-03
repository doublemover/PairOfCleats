import fsPromises from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_VOLATILE_KEYS = ['generatedAt'];

const toOmitKeySet = (omitKeys = []) => new Set(Array.isArray(omitKeys) ? omitKeys : []);

const normalizeJsonValueInternal = (value, omitKeys) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValueInternal(entry, omitKeys));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      if (omitKeys.has(key)) return acc;
      acc[key] = normalizeJsonValueInternal(value[key], omitKeys);
      return acc;
    }, {});
};

export const normalizeGeneratedJsonValue = (value, options = {}) => (
  normalizeJsonValueInternal(value, toOmitKeySet(options.omitKeys))
);

export const stringifyGeneratedJson = (value, options = {}) => {
  const spaces = Number.isInteger(options?.spaces) ? options.spaces : 2;
  return JSON.stringify(normalizeGeneratedJsonValue(value, options), null, spaces);
};

export const normalizeGeneratedPayload = (payload, options = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const volatileKeys = Array.isArray(options.volatileKeys) && options.volatileKeys.length
    ? options.volatileKeys
    : DEFAULT_VOLATILE_KEYS;
  const normalized = normalizeGeneratedJsonValue(payload, {
    omitKeys: options.omitKeys || []
  });
  for (const key of volatileKeys) {
    normalized[key] = null;
  }
  return normalized;
};

const shouldPreserveGeneratedAt = (existingPayload, nextPayload, options = {}) => (
  typeof existingPayload?.generatedAt === 'string'
  && JSON.stringify(normalizeGeneratedPayload(existingPayload, options))
    === JSON.stringify(normalizeGeneratedPayload(nextPayload, options))
);

export const preserveGeneratedAt = (existingPayload, nextPayload, options = {}) => (
  shouldPreserveGeneratedAt(existingPayload, nextPayload, options)
    ? { ...nextPayload, generatedAt: existingPayload.generatedAt }
    : nextPayload
);

export async function writeTextIfChanged(outputPath, content, options = {}) {
  const encoding = options.encoding || 'utf8';
  let existingText = null;
  try {
    existingText = await fsPromises.readFile(outputPath, encoding);
  } catch {}
  if (existingText === content) return false;
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, content, encoding);
  return true;
}

export async function writeStableGeneratedJsonReport(outputPath, report, options = {}) {
  let existingPayload = null;
  try {
    existingPayload = JSON.parse(await fsPromises.readFile(outputPath, 'utf8'));
  } catch {}

  const nextReport = preserveGeneratedAt(existingPayload, report, options);
  const spaces = options.spaces ?? 2;
  const serialized = JSON.stringify(nextReport, null, spaces);
  const trailingNewline = options.trailingNewline !== false;
  await writeTextIfChanged(outputPath, trailingNewline ? `${serialized}\n` : serialized);
  return nextReport;
}
