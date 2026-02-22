import { lineHasAnyInsensitive, shouldScanLine, stripInlineCommentAware } from './utils.js';

const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const MAKEFILE_OPTION_TOKEN_RX = /^\/{1,2}[A-Z][A-Z0-9_-]*(?::|$)/;
const MAKEFILE_VARIABLE_TOKEN_RX = /\$\([^)]+\)/;
const MAKEFILE_SPECIAL_TARGETS = new Set([
  '.DEFAULT',
  '.DELETE_ON_ERROR',
  '.EXPORT_ALL_VARIABLES',
  '.FORCE',
  '.IGNORE',
  '.INTERMEDIATE',
  '.LOW_RESOLUTION_TIME',
  '.NOTPARALLEL',
  '.ONESHELL',
  '.PHONY',
  '.POSIX',
  '.PRECIOUS',
  '.SECONDARY',
  '.SECONDEXPANSION',
  '.SILENT',
  '.SUFFIXES',
  '.SYMBOLIC',
  '.WAIT'
]);

const normalizeToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[;,]+$/g, '');
  if (!stripped) return '';
  if (SCHEME_RELATIVE_URL_RX.test(stripped)) return `https:${stripped}`;
  return stripped;
};

const isMakefilePseudoDependencyToken = (token) => {
  if (!token) return true;
  if (token === '|' || token === '\\') return true;
  const upper = token.toUpperCase();
  if (MAKEFILE_SPECIAL_TARGETS.has(upper) || upper === '.OBJ') return true;
  if (MAKEFILE_OPTION_TOKEN_RX.test(token)) return true;
  if (MAKEFILE_VARIABLE_TOKEN_RX.test(token)) return true;
  return false;
};

export const collectMakefileImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['include', ':']);
  const addImport = (value, { fromDependency = false } = {}) => {
    const token = normalizeToken(value);
    if (!token) return;
    if (fromDependency && isMakefilePseudoDependencyToken(token)) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const trimmed = stripInlineCommentAware(line, { markers: ['#'] }).trim();
    if (!trimmed) continue;
    const includeMatch = trimmed.match(/^\s*(?:-?include|sinclude)\s+(.+)$/i);
    if (includeMatch) {
      const includeExpr = includeMatch[1];
      const wildcard = includeExpr.match(/\$\(wildcard\s+([^)]+)\)/i);
      if (wildcard?.[1]) {
        for (const part of wildcard[1].split(/\s+/).filter(Boolean)) addImport(part);
      } else {
        for (const part of includeExpr.split(/\s+/).filter(Boolean)) addImport(part);
      }
    }
    const depMatch = trimmed.match(/^[A-Za-z0-9_./%-]+(?:\s+[A-Za-z0-9_./%-]+)*\s*:\s*([^=].*)$/);
    if (!depMatch) continue;
    const deps = depMatch[1].split(/\s+/).map((entry) => entry.trim()).filter(Boolean);
    for (const dep of deps) {
      addImport(dep, { fromDependency: true });
    }
  }
  return Array.from(imports);
};
