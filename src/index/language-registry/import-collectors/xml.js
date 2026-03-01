import { createCollectorBudgetContext, isPseudoImportToken, lineHasAnyInsensitive, shouldScanLine } from './utils.js';

const ATTRIBUTE_TOKENS = ['schemaLocation', 'href', 'src', 'location', 'file', 'path', 'url', 'project'];
const XML_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token || isPseudoImportToken(token)) return;
  imports.add(token);
};

const parseSchemaLocation = (value, imports, scanBudget = null) => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  for (const part of parts) {
    if (scanBudget && !scanBudget.consumeToken()) break;
    if (part.includes('/') || part.includes('.') || part.includes(':')) {
      addImport(imports, part);
    }
  }
};

export const collectXmlImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'xml',
    defaults: XML_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  try {
    const source = String(budgetContext.source || '').replace(/<!--[\s\S]*?-->/g, '\n');
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
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (!shouldScanLine(line, precheck)) continue;
      const includeOrImportTag = line.match(/<\s*(?:[A-Za-z0-9_.-]+:)?(?:include|import)\b([^>]*)>/i);
      if (includeOrImportTag?.[1]) {
        for (const attr of ATTRIBUTE_TOKENS) {
          if (!scanBudget.consumeMatch()) break;
          const attrRe = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
          const attrMatch = includeOrImportTag[1].match(attrRe);
          if (!attrMatch?.[1]) continue;
          if (attr.toLowerCase() === 'schemalocation') {
            parseSchemaLocation(attrMatch[1], imports, scanBudget);
          } else if (scanBudget.consumeToken()) {
            addImport(imports, attrMatch[1]);
          }
        }
      }
      const schemaMatcher = /\bxsi:schemaLocation\s*=\s*["']([^"']+)["']/g;
      let match;
      while (!scanBudget.exhausted && (match = schemaMatcher.exec(line)) !== null) {
        if (!scanBudget.consumeMatch()) break;
        parseSchemaLocation(match[1], imports, scanBudget);
        if (!match[0]) schemaMatcher.lastIndex += 1;
      }
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
