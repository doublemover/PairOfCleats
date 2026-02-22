import fs from 'node:fs';
import { normalizeRepoRelativePath } from '../../shared/path-normalize.js';

export const resolveFormat = (argv) => {
  const formatRaw = argv.format || (argv.json ? 'json' : 'json');
  const format = String(formatRaw).trim().toLowerCase();
  if (format === 'md' || format === 'markdown') return 'md';
  return 'json';
};

export const mergeCaps = (baseCaps, overrides) => {
  const merged = { ...(baseCaps || {}) };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null) continue;
    merged[key] = value;
  }
  return merged;
};

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

export const emitCliOutput = ({ format, payload, renderMarkdown }) => {
  if (format === 'md') {
    console.log(renderMarkdown(payload));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
};

export const emitCliError = ({ format, code, message }) => {
  const errorPayload = { ok: false, code, message };
  if (format === 'json') {
    console.log(JSON.stringify(errorPayload, null, 2));
  } else {
    console.error(message);
  }
  return errorPayload;
};
