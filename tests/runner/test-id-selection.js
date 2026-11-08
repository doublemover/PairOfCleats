import { readFileResourceBytesSync } from '../../src/shared/file-read-resource.js';

/** Narrow an existing selection, preserving its execution order and guards. */
export const selectTestIds = (selection, requested) => {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100000
    || requested.some(id => typeof id !== 'string' || !id.length || id.length > 4096 || /[\x00-\x1f]/u.test(id))
    || new Set(requested).size !== requested.length) throw new Error('Exact test IDs must be a bounded nonempty unique string array.');
  const ids = new Set(requested), available = new Set(selection.map(test => test.id));
  const missing = requested.filter(id => !available.has(id));
  if (missing.length) throw new Error(`Exact test IDs are outside the current selection: ${missing.slice(0, 10).join(', ')}`);
  return selection.filter(test => ids.has(test.id));
};

export const readTestIdSelection = file => {
  const bytes = readFileResourceBytesSync(file, stat => {
    if (stat.size > 4 * 1024 * 1024) throw new Error('Exact test selection exceeds its byte bound.');
  });
  const document = JSON.parse(bytes);
  if (document?.schemaVersion !== 1) throw new Error('Unsupported exact test selection.');
  return document.ids;
};
