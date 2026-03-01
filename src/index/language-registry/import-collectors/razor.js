import {
  addCollectorImport,
  createCommentAwareLineStripper,
  lineHasAnyInsensitive,
  shouldScanLine
} from './utils.js';

const RAZOR_USING_DIRECTIVE_RX = /^\s*@using\s+(.+)$/i;
const RAZOR_USING_TARGET_RX = /^(?:(?:static)\s+)?(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?((?:global::)?[A-Za-z_][A-Za-z0-9_]*(?:(?:\.|::)[A-Za-z_][A-Za-z0-9_]*)*)$/i;

const parseRazorUsingTarget = (line) => {
  const directiveMatch = String(line || '').match(RAZOR_USING_DIRECTIVE_RX);
  if (!directiveMatch?.[1]) return '';
  const clause = directiveMatch[1].trim().replace(/[;]+$/g, '');
  if (!clause || clause.startsWith('(')) return '';
  const targetMatch = clause.match(RAZOR_USING_TARGET_RX);
  return targetMatch?.[1] ? targetMatch[1].trim() : '';
};

export const collectRazorImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['//'],
    blockCommentPairs: [['@*', '*@']],
    requireWhitespaceBefore: true
  });
  const precheck = (value) => lineHasAnyInsensitive(value, ['@using']);
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = stripComments(rawLine);
    if (!line.trim()) continue;
    const token = parseRazorUsingTarget(line);
    if (token) addCollectorImport(imports, token);
  }
  return Array.from(imports);
};
