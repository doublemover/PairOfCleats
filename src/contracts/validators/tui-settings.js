import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_SETTINGS_REQUEST_SCHEMAS } from '../schemas/tui-settings.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_SETTINGS_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
const invalid = () => { throw Object.assign(new TypeError('Malformed or oversized TUI settings request.'),
  { code: 'ERR_TUI_SETTINGS_REQUEST' }); };

/** Bound arbitrary JSON before recursive validators, stringification or redaction. */
export const assertTuiSettingsRequest = (kind, value) => {
  const stack = [{ value, depth: 0 }], seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (++nodes > 4096 || entry.depth > 20) invalid();
    if (entry.value && typeof entry.value === 'object') {
      if (seen.has(entry.value)) invalid();
      seen.add(entry.value);
      const prototype = Object.getPrototypeOf(entry.value);
      if (!Array.isArray(entry.value) && prototype !== Object.prototype && prototype !== null) invalid();
      for (const key in entry.value) {
        if (!Object.hasOwn(entry.value, key)) continue;
        if (nodes + stack.length >= 4096) invalid();
        stack.push({ value: entry.value[key], depth: entry.depth + 1 });
      }
    } else if (entry.value !== null && !['boolean', 'number', 'string'].includes(typeof entry.value)) invalid();
    else if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > 128 * 1024 || !validators[kind]?.(value)) invalid();
  return value;
};
