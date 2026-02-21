import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

const ATTRIBUTE_TOKENS = ['schemaLocation', 'href', 'src', 'location', 'file', 'path', 'url'];

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token) return;
  imports.add(token);
};

const parseSchemaLocation = (value, imports) => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  for (const part of parts) {
    if (part.includes('/') || part.includes('.') || part.includes(':')) {
      addImport(imports, part);
    }
  }
};

export const collectXmlImports = (text) => {
  const imports = new Set();
  const source = String(text || '').replace(/<!--[\s\S]*?-->/g, '\n');
  const lines = source.split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    '<',
    'include',
    'import',
    'schema',
    'href',
    'location',
    'xmlns'
  ]);

  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const includeOrImportTag = line.match(/<\s*(?:[A-Za-z0-9_.-]+:)?(?:include|import)\b([^>]*)>/i);
    if (includeOrImportTag?.[1]) {
      for (const attr of ATTRIBUTE_TOKENS) {
        const attrRe = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
        const attrMatch = includeOrImportTag[1].match(attrRe);
        if (!attrMatch?.[1]) continue;
        if (attr.toLowerCase() === 'schemalocation') {
          parseSchemaLocation(attrMatch[1], imports);
        } else {
          addImport(imports, attrMatch[1]);
        }
      }
    }

    const xmlnsMatches = Array.from(line.matchAll(/\bxmlns:([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*["']([^"']+)["']/g));
    for (const match of xmlnsMatches) {
      addImport(imports, `namespace:${match[1]}=${match[2]}`);
    }

    const schemaLocationMatches = Array.from(line.matchAll(/\bxsi:schemaLocation\s*=\s*["']([^"']+)["']/g));
    for (const match of schemaLocationMatches) {
      parseSchemaLocation(match[1], imports);
    }
  }

  return Array.from(imports);
};
