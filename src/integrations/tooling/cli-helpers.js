import fs from 'node:fs';
import { normalizeRepoRelativePath } from '../../shared/path-normalize.js';

/**
 * Resolve output format from parsed CLI args.
 *
 * @param {object} argv
 * @returns {'md'|'json'}
 */
export const resolveFormat = (argv) => {
  const formatRaw = argv.format || (argv.json ? 'json' : 'md');
  const format = String(formatRaw).trim().toLowerCase();
  if (format === 'md' || format === 'markdown') return 'md';
  return 'json';
};

/**
 * Merge capability maps, ignoring null/undefined overrides.
 *
 * @param {object|null} baseCaps
 * @param {object|null} overrides
 * @returns {object}
 */
export const mergeCaps = (baseCaps, overrides) => {
  const merged = { ...(baseCaps || {}) };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null) continue;
    merged[key] = value;
  }
  return merged;
};

/**
 * Parse list-like CLI input (array or comma-separated string).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).map((entry) => entry.trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

/**
 * Parse changed-file inputs from inline list and optional file path.
 *
 * @param {{changed?:string|string[],changedFile?:string|null}} input
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const parseChangedInputs = ({ changed, changedFile }, repoRoot) => {
  const entries = [];
  for (const item of parseList(changed)) {
    entries.push(item);
  }
  if (changedFile) {
    const contents = fs.readFileSync(String(changedFile), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) entries.push(trimmed);
    }
  }
  const resolved = [];
  for (const entry of entries) {
    const rel = normalizeRepoRelativePath(entry, repoRoot);
    if (!rel) continue;
    resolved.push(rel);
  }
  return resolved;
};

/**
 * Emit CLI payload in selected format and return payload.
 *
 * @param {{format:'md'|'json',payload:any,renderMarkdown:(payload:any)=>string}} input
 * @returns {any}
 */
export const emitCliOutput = ({ format, payload, renderMarkdown }) => {
  if (format === 'md') {
    console.log(renderMarkdown(payload));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
};

/**
 * Emit standardized CLI error payload in selected format.
 *
 * @param {{format:'md'|'json',code:string,message:string}} input
 * @returns {{ok:false,code:string,message:string}}
 */
export const emitCliError = ({ format, code, message }) => {
  const errorPayload = { ok: false, code, message };
  if (format === 'json') {
    console.log(JSON.stringify(errorPayload, null, 2));
  } else {
    console.error(message);
  }
  return errorPayload;
};
