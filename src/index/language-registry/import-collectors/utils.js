export const MAX_REGEX_LINE = 8192;
const PSEUDO_TOKEN_RE = /^(?:anchor|alias|dependency|namespace):/i;

export const shouldScanLine = (line, precheck) => {
  if (!line) return false;
  if (line.length > MAX_REGEX_LINE) return false;
  if (precheck && !precheck(line)) return false;
  return true;
};

export const lineHasAny = (line, tokens) => {
  for (const token of tokens) {
    if (line.includes(token)) return true;
  }
  return false;
};

export const lineHasAnyInsensitive = (line, tokens) => {
  const lower = line.toLowerCase();
  for (const token of tokens) {
    if (lower.includes(token)) return true;
  }
  return false;
};

export const isPseudoImportToken = (value) => PSEUDO_TOKEN_RE.test(String(value || '').trim());

/**
 * Strip inline comments while respecting quoted strings.
 *
 * @param {string} line
 * @param {{markers?: string[], requireWhitespaceBefore?: boolean}} [options]
 * @returns {string}
 */
export const stripInlineCommentAware = (
  line,
  { markers = ['#'], requireWhitespaceBefore = false } = {}
) => {
  const source = String(line || '');
  if (!source) return '';
  const markerSet = new Set(
    markers
      .map((marker) => String(marker || ''))
      .filter((marker) => marker.length === 1)
  );
  if (!markerSet.size) return source;

  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (char === "'") {
        if (source[i + 1] === "'") {
          i += 1;
          continue;
        }
        inSingle = false;
      }
      continue;
    }
    if (char === '"') {
      inDouble = true;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (!markerSet.has(char)) continue;
    if (requireWhitespaceBefore && i > 0 && /\S/.test(source[i - 1])) continue;
    return source.slice(0, i).trimEnd();
  }
  return source;
};

/**
 * Collect import-like symbols from JVM-style languages that share `import`,
 * `package`, and optional type-reference keywords (for example `extends`,
 * `implements`, `with`).
 *
 * @param {string} text
 * @param {{precheckTokens?:string[],typeReferenceKeywords?:string[]}} [options]
 * @returns {string[]}
 */
export const collectJvmStyleImports = (
  text,
  {
    precheckTokens = ['import', 'package', 'extends'],
    typeReferenceKeywords = ['extends'],
    includePackageDeclarations = false
  } = {}
) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, precheckTokens);
  const typeKeywordPattern = typeReferenceKeywords
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .join('|');
  const typeRefRegex = typeKeywordPattern
    ? new RegExp(`\\b(?:${typeKeywordPattern})\\s+([A-Za-z_][A-Za-z0-9_.]*)`, 'g')
    : null;
  const addImport = (value) => {
    const token = String(value || '').trim().replace(/[;]+$/g, '');
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatch = line.match(/^\s*import\s+([^\s;]+)/);
    if (importMatch?.[1]) addImport(importMatch[1]);
    if (includePackageDeclarations) {
      const packageMatch = line.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/);
      if (packageMatch?.[1]) addImport(packageMatch[1]);
    }
    if (!typeRefRegex) continue;
    const typeRefMatches = line.matchAll(typeRefRegex);
    for (const match of typeRefMatches) {
      if (match?.[1]) addImport(match[1]);
    }
  }
  return Array.from(imports);
};

/**
 * Collect `{{> partial}}` template partial references.
 *
 * @param {string} text
 * @param {{lineTokens?:string[]}} [options]
 * @returns {string[]}
 */
export const collectTemplatePartialImports = (text, { lineTokens = ['{{>'] } = {}) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, lineTokens);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const matches = line.matchAll(/\{\{>\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/g);
    for (const match of matches) {
      const token = String(match[1] || match[2] || match[3] || '').trim();
      if (!token || isPseudoImportToken(token)) continue;
      imports.push(token);
    }
  }
  return imports;
};
